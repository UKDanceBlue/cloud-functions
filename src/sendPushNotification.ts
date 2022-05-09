import { v4 as generateUuid } from "uuid";
import * as functions from "firebase-functions";
import {
  DocumentData,
  DocumentSnapshot,
  getFirestore,
  Query,
  QueryDocumentSnapshot,
} from "firebase-admin/firestore";
import Expo, {
  ExpoPushErrorReceipt,
  ExpoPushMessage,
  ExpoPushSuccessTicket,
} from "expo-server-sdk";

export type SendPushNotificationArgument = {
  notificationTitle?: string;
  notificationBody?: string;
  notificationPayload?: unknown;
  // If this is going to specific users we get *notificationRecipients*, if many we get *notificationAudiences*.
  notificationAudiences?: { [key: string]: string[] };
  notificationRecipients?: string[];
};

export default functions
  .runWith({ secrets: ["EXPO_ACCESS_TOKEN"] })
  .https.onCall(async (data: SendPushNotificationArgument, context) => {
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
    if (
      (typeof senderCommitteeRank === "string" &&
        !["advisor", "overall-chair", "chair"].includes(senderCommitteeRank)) ||
      senderCommittee === "tech-committee"
    ) {
      throw new functions.https.HttpsError(
        "permission-denied",
        "This function may only be used by a chair or a member of the tech committee."
      );
    }

    const {
      notificationTitle,
      notificationBody,
      notificationPayload,
      // If this is going to specific users we get *notificationRecipients*, if many we get *notificationAudiences*.
      notificationAudiences,
      notificationRecipients,
    } = data;

    if (!notificationTitle) {
      throw new functions.https.HttpsError("invalid-argument", "Notification title is required.");
    }

    if (!notificationBody) {
      throw new functions.https.HttpsError("invalid-argument", "Notification body is required.");
    }

    const firestore = getFirestore();
    // Generate a notification ID and document.
    const notificationId = generateUuid();
    const notificationDocument = firestore.collection("past-notifications").doc(notificationId);
    const notificationContent = {
      title: notificationTitle,
      body: notificationBody,
      payload: notificationPayload,
    };
    const notificationDocumentCreation = notificationDocument.create(notificationContent);

    let userDocuments;

    if (notificationAudiences) {
      // Get the user documents for the notification.
      userDocuments = await getUserDocumentsForNotification(notificationAudiences);
    } else if (notificationRecipients && Array.isArray(notificationRecipients)) {
      // Get the user documents for the notification.
      userDocuments = await Promise.all(
        notificationRecipients.map((recipient) =>
          firestore.collection("users").doc(recipient).get()
        )
      );
    }

    if (!userDocuments || !Array.isArray(typeof userDocuments)) {
      throw new functions.https.HttpsError("internal", "User document type assertion failed");
    }

    // Make sure the notification's document has been created before we add a reference to it.
    await notificationDocumentCreation;

    // Add the reference to the notification to the user documents.
    await Promise.all(
      userDocuments.map((userDocument) =>
        // Update the user document.
        firestore.collection(`users/${userDocument.id}/notifications`).doc(notificationId).set({
          ref: notificationDocument,
        })
      )
    );

    // Create a new Expo SDK client
    const expo = new Expo({ accessToken: process.env.EXPO_PUSH_TOKEN });

    const chunks = chunkNotification(notificationContent, userDocuments, expo);

    return sendChunks(chunks, expo);
  });

/**
 * Find users who should receive a notification.
 *
 * @param notificationAudiences - The audiences to send the notification to.
 * @return - The user documents of the users who should receive the notification.
 */
async function getUserDocumentsForNotification(notificationAudiences: {
  [key: string]: string[];
}): Promise<QueryDocumentSnapshot<DocumentData>[]> {
  const devMode = true;
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

  let usersQuery: Query = firestore.collection("users");

  const notificationAudiencesEntries = Object.entries(notificationAudiences);
  for (const [audience, audienceValues] of notificationAudiencesEntries) {
    usersQuery = usersQuery.where(audience, "in", audienceValues);

    if (devMode) {
      functions.logger.log(
        `Added audience ${audience} with values ${JSON.stringify(audienceValues)} to query.`
      );
    }
  }

  const users = await usersQuery.get();
  return users.docs;
}

/**
 * This function breaks the notification up into chunks and adds a to field with the push notifications from userDocuments.
 *
 * @param notificationContent - The content of the notification.
 * @param userDocuments - The user documents to send the notification to.
 * @param expo - The Expo SDK client.
 * @return - The chunked notifications.
 */
function chunkNotification(
  notificationContent: { title: string; body: string; payload: unknown },
  userDocuments: DocumentSnapshot[],
  expo: Expo
): ExpoPushMessage[][] {
  const tokens: string[] = [];
  userDocuments.forEach((userDocument) => {
    const registeredPushTokens = userDocument.get("registeredPushTokens") as unknown;
    if (Array.isArray(registeredPushTokens)) {
      registeredPushTokens.forEach((token: string) => tokens.push(token));
    }
  });

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
 * @param {((Expo.ExpoPushMessage)[])[]} chunks - The chunks of notifications to send.
 * @param {Expo} expo - The Expo SDK client.
 * @return {Promise<(Expo.ExpoPushSuccessTicket | Expo.ExpoPushErrorReceipt)[]>} - The promise of the Expo SDK client.
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
