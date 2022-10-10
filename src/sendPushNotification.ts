import {
  Expo,
  ExpoPushErrorReceipt,
  ExpoPushMessage,
  ExpoPushSuccessTicket,
} from "expo-server-sdk";
import {
  DocumentData,
  Query,
  QueryDocumentSnapshot,
  getFirestore,
} from "firebase-admin/firestore";
import * as functions from "firebase-functions";
import { v4 as generateUuid } from "uuid";

export type SendPushNotificationArgument = {
  notificationTitle?: string;
  notificationBody?: string;
  notificationPayload?: unknown;
  // If this is going to specific users we get *notificationRecipients*, if many we get *notificationAudiences*.
  notificationAudiences?: Record<string, string[]>;
  notificationRecipients?: string[];
  sendToAll?: boolean;
  dryRun?: boolean;
};

/**
 * Sends a push notification to the specified recipients.
 *
 * If dryRun is true, the notification will not be sent to any recipients unless
 * notificationRecipients is specified, in that case it will send a notification,
 * but will not add any trace of that notification to firestore.
 *
 * notificationPayload is treated as an opaque object, and will be passed to the
 * client as is.
 *
 * If notificationAudiences is specified, the notification will be sent to all
 * users that match the specified audiences.
 *
 * If notificationRecipients is specified, the notification will be sent to all
 * users that match the specified recipients (UIDs).
 *
 * If sendToAll is true, the notification will be sent to all possible users.
 */
export default functions
  .runWith({ secrets: ["EXPO_ACCESS_TOKEN"] })
  .https.onCall(async (data: SendPushNotificationArgument, context) => {
    verifyContext(context);

    const {
      notificationTitle,
      notificationBody,
      notificationPayload,
      // If this is going to specific users we get *notificationRecipients*, if many we get *notificationAudiences*, if we are sending to all devices (NOT LIMITED TO USERS) we get sendToAll
      notificationAudiences: notificationAudiencesRaw,
      notificationRecipients,
      sendToAll,
      dryRun
    } = data;

    const notificationAudiences = notificationAudiencesRaw == null ? undefined : [notificationAudiencesRaw];

    if (!notificationTitle) {
      throw new functions.https.HttpsError("invalid-argument", "Notification title is required.");
    }

    if (!notificationBody) {
      throw new functions.https.HttpsError("invalid-argument", "Notification body is required.");
    }

    // Make sure exactly one of notificationAudiences, notificationRecipients, or sendToAll is specified.
    if ((+(notificationAudiences != null) + +(notificationRecipients != null) + +(sendToAll != null && sendToAll)) !== 1) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "Exactly one of notificationAudiences, notificationRecipients, or sendToAll is allowed."
      );
    }

    if (dryRun) {
      functions.logger.info("Dry run requested, not sending any notifications (unless notificationRecipients is specified).");
    }

    const firestore = getFirestore();
    const writeBatch = firestore.batch();

    // Generate a notification ID and document.
    const notificationId = generateUuid();
    const notificationDocument = firestore.collection("past-notifications").doc(notificationId);
    const notificationContent = {
      title: notificationTitle,
      body: notificationBody,
      payload: notificationPayload,
    };
    writeBatch.create(notificationDocument, notificationContent);

    // Create a new Expo SDK client
    const expo = new Expo({ accessToken: process.env.EXPO_ACCESS_TOKEN });

    const tokens: string[] = [];

    if (sendToAll) {
      functions.logger.info("Sending to all users.");

      const deviceDocuments = await firestore.collection("devices").where("expoPushToken", "!=", null).get();

      const tokensToAdd: string[] = [];
      for (const deviceDocument of deviceDocuments.docs) {
        const device = deviceDocument.data() as { expoPushToken: string, latestUserId?: string | null };
        tokensToAdd.push(device.expoPushToken);

        if (device.latestUserId != null) {
          writeBatch.set(firestore.collection(`users/${device.latestUserId}/notifications`).doc(notificationId), {
            ref: notificationDocument,
          });
        }
      }

      tokens.push(...tokensToAdd);
    } else if (notificationAudiences && Array.isArray(notificationAudiences)) {
      // Get the user documents for the notification.
      const userDocuments = await getUserDocumentsForNotification(notificationAudiences);

      if (!userDocuments || !Array.isArray(userDocuments)) {
        throw new functions.https.HttpsError("internal", "User document type assertion failed");
      }

      // Add the reference to the notification to the user documents.
      userDocuments.forEach((userDocument) =>
        // Update the user document.
        writeBatch.set(firestore.collection(`users/${userDocument.id}/notifications`).doc(notificationId), {
          ref: notificationDocument,
        })
      );

      userDocuments.forEach((userDocument) => {
        const registeredPushTokens = userDocument.get("registeredPushTokens") as unknown;
        if (Array.isArray(registeredPushTokens)) {
          registeredPushTokens.forEach((token: string) => tokens.push(token));
        }
      });
    } else if (notificationRecipients && Array.isArray(notificationRecipients)) {
      // Get the user documents for the notification.
      const userDocuments = await Promise.all(
        notificationRecipients.map((recipient) =>
          firestore.collection("users").doc(recipient).get()
        )
      );

      // Add the reference to the notification to the user documents.
      userDocuments.forEach((userDocument) =>
        // Update the user document.
        writeBatch.set(firestore.collection(`users/${userDocument.id}/notifications`).doc(notificationId), {
          ref: notificationDocument,
        })
      );

      userDocuments.forEach((userDocument) => {
        const registeredPushTokens = userDocument.get("registeredPushTokens") as unknown;
        if (Array.isArray(registeredPushTokens)) {
          registeredPushTokens.forEach((token: string) => tokens.push(token));
        }
      });
    }

    if (!dryRun) {
      try {
        // Commit the write batch.
        await writeBatch.commit();
      } catch (error) {
        functions.logger.error("Failed to commit write batch", error);
        throw new functions.https.HttpsError("internal", "Failed to commit write batch");
      }
    }

    if (!dryRun || (dryRun && notificationRecipients && Array.isArray(notificationRecipients))) {
      const chunks = chunkNotification(notificationContent, tokens, expo);

      return sendChunks(chunks, expo);
    } else {
      return [];
    }
  });

function verifyContext(context: functions.https.CallableContext) {
  // Make sure the function is called while authenticated.
  if (!context?.auth?.uid) {
    throw new functions.https.HttpsError(
      "unauthenticated",
      "This function must be used while authenticated."
    );
  }

  const {
    token: { committee: senderCommittee, committeeRank: senderCommitteeRank },
  } = context.auth;

  // Make sure the user has the committeeRank claim.
  if (typeof senderCommitteeRank !== "string") {
    throw new functions.https.HttpsError(
      "permission-denied",
      "This user does not have the committeeRank claim."
    );
  }
  if (!(
    ["advisor", "overall-chair", "chair"].includes(senderCommitteeRank) ||
    senderCommittee === "tech-committee"
  )) {
    throw new functions.https.HttpsError(
      "permission-denied",
      "This function may only be used by a chair or a member of the tech committee."
    );
  }
}

/**
* Find users who should receive a notification.
*
* @param notificationAudiences The audiences to send the notification to.
* @return The user documents of the users who should receive the notification.
*/
async function getUserDocumentsForNotification(notificationAudiences: Record<string, string[]>[]): Promise<QueryDocumentSnapshot<DocumentData>[]> {
  // Check number of audiences
  if (
    !(typeof notificationAudiences === "object" && Object.keys(notificationAudiences).length > 0)
  ) {
    throw new functions.https.HttpsError(
      "invalid-argument",
      "At least one audience parameter must be specified."
    );
  }
  if (Object.keys(notificationAudiences).length > 10) {
    throw new functions.https.HttpsError(
      "invalid-argument",
      "Specify fewer than 10 audience parameters."
    );
  }

  // Get the firestore instance.
  const firestore = getFirestore();

  const allUserDocsPromises: Promise<FirebaseFirestore.QuerySnapshot<DocumentData>>[] = [];
  for (let i = 0; i < notificationAudiences.length; i++) {
    let usersQuery: Query = firestore.collection("users");

    const notificationAudiencesEntries = Object.entries(notificationAudiences);
    for (const [audience, audienceValues] of notificationAudiencesEntries) {
      usersQuery = usersQuery.where(`attributes.${audience}`, "in", audienceValues);
    }

    allUserDocsPromises.push(usersQuery.get());
  }
  return (await Promise.all(allUserDocsPromises)).flatMap((querySnapshot) => querySnapshot.docs);
}

/**
 * This function breaks the notification up into chunks and adds a to field with the push notifications from userDocuments.
 *
 * @param notificationContent The content of the notification.
 * @param tokens The push tokens to send the notification to.
 * @param expo The Expo SDK client.
 * @return The chunked notifications.
 */
function chunkNotification(
  notificationContent: { title: string; body: string; payload: unknown },
  tokens: string[],
  expo: Expo
): ExpoPushMessage[][] {
  // !! Create the messages that you want to send to clients !!
  const messages = [];
  for (const pushToken of tokens) {
    // Each push token should look like "ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]"
    if (!Expo.isExpoPushToken(pushToken)) {
      // TODO remove the token when this happens
      functions.logger.error(`Push token ${pushToken as string} is not a valid Expo push token`);
    } else {
      // Construct a message (see https://docs.expo.io/push-notifications/sending-notifications/)
      messages.push({ to: pushToken, ...notificationContent });
    }
  }

  // The Expo push notification service accepts batches of notifications so
  // that you don't need to send 1000 requests to send 1000 notifications. We
  // recommend you batch your notifications to reduce the number of requests
  // and to compress them (notifications with similar content will get
  // compressed).
  return expo.chunkPushNotifications(messages);
}

/**
 * This function sends the chunks of notifications to Expo.
 *
 * @param chunks The chunks of notifications to send.
 * @param expo The Expo SDK client.
 * @return The promise of the Expo SDK client.
 */
async function sendChunks(
  chunks: ExpoPushMessage[][],
  expo: Expo
): Promise<(ExpoPushSuccessTicket | ExpoPushErrorReceipt)[]> {
  const ticketChunks = [];

  // Send the chunks to the Expo push notification service. There are
  // different strategies you could use. A simple one is to send one chunk at a
  // time, which nicely spreads the load out over time:
  for (const chunk of chunks) {
    try {
      const ticketChunk = await expo.sendPushNotificationsAsync(chunk);
      ticketChunks.push(ticketChunk);
    } catch (error) {
      throw new functions.https.HttpsError(
        "internal",
        `There was an error sending a push notification: ${JSON.stringify(error)}`,
        chunk
      );
    }
  }

  // TODO handle DeviceNotRegistered error here

  // Remove any debug info from the ticket as this will be sent to the client.
  return ticketChunks.flat().map((ticket) => {
    if ((ticket as { __debug: unknown }).__debug) {
      delete (ticket as { __debug: unknown }).__debug;
    }
    return ticket;
  });
}
