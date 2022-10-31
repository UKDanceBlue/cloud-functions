import dayjs from "dayjs"
import {
  Expo,
  ExpoPushErrorReceipt,
  ExpoPushMessage,
  ExpoPushSuccessTicket,
} from "expo-server-sdk";
import {
  DocumentData,
  DocumentReference,
  FieldPath,
  FieldValue,
  Query,
  QueryDocumentSnapshot,
  getFirestore,
} from "firebase-admin/firestore";
import { https, logger, runWith } from "firebase-functions";
import { v4 as generateUuid } from "uuid";

export type SendPushNotificationArgument = {
  notificationTitle?: string;
  notificationBody?: string;
  notificationPayload?: unknown;
  // If this is going to specific users we get *notificationRecipients*, if many we get *notificationAudiences*.
  notificationAudiences?: Record<string, (string | boolean | number)[]>;
  notificationRecipients?: string[];
  sendToAll?: boolean;
  dryRun?: boolean;
};

interface FirestoreNotification {
  body: string;
  payload?: unknown;
  sendTime: string;
  sound?: string;
  title: string;
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
export default runWith({ secrets: ["EXPO_ACCESS_TOKEN"] })
  .https.onCall(async (data: SendPushNotificationArgument, context) => {
    logger.debug("'sendPushNotification' called");
    verifyContext(context);
    logger.debug("'sendPushNotification' verified context");

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

    logger.debug("Checking validity of arguments");

    const notificationAudiences = notificationAudiencesRaw == null ? undefined : [notificationAudiencesRaw];

    if (!notificationTitle || typeof notificationTitle !== "string") {
      throw new https.HttpsError("invalid-argument", "Notification title is required and must be a string.");
    }

    if (!notificationBody || typeof notificationBody !== "string") {
      throw new https.HttpsError("invalid-argument", "Notification body is required and must be a string.");
    }

    // Make sure exactly one of notificationAudiences, notificationRecipients, or sendToAll is specified and that it is valid.
    if (notificationAudiences != null && notificationRecipients == null && (sendToAll == null || sendToAll === false)) {
      // notificationAudiences should be pretty small so we should be able to iterate over it
      for (const audience of notificationAudiences) {
        if (typeof audience !== "object") {
          throw new https.HttpsError("invalid-argument", "Notification audiences must be an object.");
        } else {
          for (const [audienceName, audienceValues] of Object.entries(audience)) {
            if (typeof audienceName !== "string") {
              throw new https.HttpsError("invalid-argument", `Notification audience names must be strings (${String(audienceName as unknown)})`);
            }
            if (!Array.isArray(audienceValues)) {
              throw new https.HttpsError("invalid-argument", `Notification audience values must be arrays of strings (${String(audienceName as unknown)}: ${JSON.stringify(audienceValues as unknown)})`);
            }
            for (const audienceValue of audienceValues) {
              if (typeof audienceValue !== "string" && typeof audienceValue !== "boolean" && typeof audienceValue !== "number") {
                throw new https.HttpsError("invalid-argument", `Notification audience values must be strings, booleans, or numbers (${String(audienceName as unknown)}: ${String(audienceValue)})`);
              }
            }
          }
        }
      }
    }
    else if (notificationAudiences == null && notificationRecipients != null && (sendToAll == null || sendToAll === false)) {
      // This might be longer though, so we just check that it is an array
      if (!Array.isArray(notificationRecipients)) {
        throw new https.HttpsError("invalid-argument", "Notification recipients must be an array.");
      }
    }
    else if (notificationAudiences == null && notificationRecipients == null && sendToAll != null) {
      if (typeof sendToAll !== "boolean") {
        throw new https.HttpsError("invalid-argument", "Send to all must be a boolean.");
      }
    }
    else {
      throw new https.HttpsError(
        "invalid-argument",
        "Exactly one of notificationAudiences, notificationRecipients, or sendToAll is allowed."
      );
    }

    logger.debug("Arguments are valid");

    if (dryRun) {
      logger.info("Dry run requested, not sending any notifications (unless notificationRecipients is specified).");
    }

    const firestore = getFirestore();
    const writeBatch = firestore.batch();

    // Generate a notification ID and document.
    const notificationId = generateUuid();

    logger.debug(`Using notification ID: ${notificationId}`);

    const notificationContent = {
      title: notificationTitle,
      body: notificationBody,
      payload: notificationPayload,
    };

    const firestoreNotificationContent: FirestoreNotification = {
      ...notificationContent,
      sendTime: dayjs().startOf("minute").toISOString(),
    };

    // Create a new Expo SDK client
    const expo = new Expo({ accessToken: process.env.EXPO_ACCESS_TOKEN });

    const tokens: string[] = [];

    // [user reference, notification reference]
    const userDocumentsAndReferences: [DocumentReference, DocumentReference][] = [];

    if (sendToAll) {
      const notificationDocument = firestore.collection("past-notifications").doc(notificationId);
      writeBatch.create(notificationDocument, firestoreNotificationContent);

      logger.info("Sending to all users.");

      const deviceDocuments = await firestore.collection("devices").where("expoPushToken", "!=", null).get();

      logger.debug(`Found ${deviceDocuments.size} devices with 'expoPushToken' set.`);

      const tokensToAdd: string[] = [];
      for (const deviceDocument of deviceDocuments.docs) {
        const device = deviceDocument.data() as { expoPushToken: unknown, latestUserId?: unknown };
        if (typeof device.expoPushToken === "string") {
          tokensToAdd.push(device.expoPushToken);
        }

        if (device.latestUserId != null && typeof device.latestUserId === "string") {
          userDocumentsAndReferences.push([firestore.collection("users").doc(device.latestUserId), notificationDocument]);
        }
      }

      logger.debug(`Adding ${tokensToAdd.length} tokens to the list of tokens to send to.`);

      tokens.push(...tokensToAdd);
    } else if (notificationAudiences && Array.isArray(notificationAudiences)) {

      const notificationDocument = firestore.collection("past-notifications").doc(notificationId);
      writeBatch.create(notificationDocument, firestoreNotificationContent);
      logger.debug("Sending to audiences.");

      // Get the user documents for the notification.
      const userDocuments = await getUserDocumentsForNotification(notificationAudiences);

      logger.debug(`Found ${userDocuments.length} users that match the specified audiences.`);

      if (!userDocuments || !Array.isArray(userDocuments)) {
        throw new https.HttpsError("internal", "User document type assertion failed");
      }

      // Add the reference to the notification to the user documents.
      userDocuments.forEach((userDocument) => {
        userDocumentsAndReferences.push([userDocument.ref, notificationDocument]);
      });

      logger.debug("Adding users' tokens to the list of tokens to send to.");

      userDocuments.forEach((userDocument) => {
        const registeredPushTokens = userDocument.get("registeredPushTokens") as unknown;
        if (Array.isArray(registeredPushTokens)) {
          registeredPushTokens.forEach((token: unknown) => typeof token === "string" ? tokens.push(token) : undefined);
        }
      });
    } else if (notificationRecipients && Array.isArray(notificationRecipients)) {
      logger.debug("Sending to specified recipients.");

      // Get the user documents for the notification.
      const userDocuments = await Promise.all(
        notificationRecipients.map((recipient) => {
          if (typeof recipient !== "string") {
            throw new https.HttpsError("invalid-argument", `Notification recipients must be strings (${String(recipient)})`);
          }
          return firestore.collection("users").doc(recipient).get()
        }
        )
      );

      logger.debug(`Found ${userDocuments.length} users that match the specified recipients.`);

      // Add the reference to the notification to the user documents.
      userDocuments.forEach((userDocument) => {
        const notificationDocument = userDocument.ref.collection("past-notifications").doc(notificationId);
        // Create the user's notification document.
        writeBatch.create(notificationDocument, firestoreNotificationContent);
        userDocumentsAndReferences.push([userDocument.ref, notificationDocument]);
      });

      logger.debug("Adding users' tokens to the list of tokens to send to.");

      userDocuments.forEach((userDocument) => {
        const registeredPushTokens = userDocument.get("registeredPushTokens") as unknown;
        if (Array.isArray(registeredPushTokens)) {
          registeredPushTokens.forEach((token: string) => tokens.push(token));
        }
      });
    }

    if (!dryRun) {
      logger.debug("Adding notifications to firestore.");
      try {
        // Commit the write batch.
        await writeBatch.commit();
        logger.debug("Write batch committed. Adding notifications to users non-transactionally.");
        const promises = userDocumentsAndReferences.map(([userDocument, notificationDocument]) => {
          return userDocument.update({
            notificationReferences: FieldValue.arrayUnion(notificationDocument),
          }).catch((error) => {
            logger.error("Error adding notification reference to user document", error);
          });
        });
        await Promise.allSettled(promises);
      } catch (error) {
        logger.error("Failed to commit write batch", error);
        throw new https.HttpsError("internal", "Failed to commit write batch");
      }
    } else {
      logger.debug("Dry run requested, not committing write batch.");
    }

    if (!dryRun || (dryRun && notificationRecipients && Array.isArray(notificationRecipients))) {
      logger.debug("Sending notifications to Expo.");
      const chunks = chunkNotification(notificationContent, tokens, expo);

      return sendChunks(chunks, expo);
    } else {
      logger.info("Dry run requested, not sending any notifications.");
      return [];
    }
  });

function verifyContext(context: https.CallableContext) {
  // Make sure the function is called while authenticated.
  if (!context?.auth?.uid) {
    throw new https.HttpsError(
      "unauthenticated",
      "This function must be used while authenticated."
    );
  }

  const {
    token: { committee: senderCommittee, committeeRank: senderCommitteeRank },
  } = context.auth;

  // Make sure the user has the committeeRank claim.
  if (typeof senderCommitteeRank !== "string") {
    throw new https.HttpsError(
      "permission-denied",
      "This user does not have the committeeRank claim."
    );
  }
  if (!(
    ["advisor", "overall-chair", "chair"].includes(senderCommitteeRank) ||
    senderCommittee === "tech-committee"
  )) {
    throw new https.HttpsError(
      "permission-denied",
      "This function may only be used by a chair or a member of the tech committee."
    );
  }
}

/**
* Find users who should receive a notification.
*
* Because firestore limits us to a single in query of up to ten options we need to be smart about how we query.
* If a particular field has only one option we can use an == query instead of an in query. If we do need multiple
* in queries we will have to pick the most specific one and then do the rest of the filtering here.
*
* @param notificationAudiences The audiences to send the notification to.
* @return The user documents of the users who should receive the notification.
*/
async function getUserDocumentsForNotification(notificationAudiences: Record<string, (string | boolean | number)[]>[]): Promise<QueryDocumentSnapshot<DocumentData>[]> {
  // Check number of audiences
  if (
    !(typeof notificationAudiences === "object" && Object.keys(notificationAudiences).length > 0)
  ) {
    throw new https.HttpsError(
      "invalid-argument",
      "At least one audience parameter must be specified."
    );
  }
  if (Object.keys(notificationAudiences).length > 10) {
    throw new https.HttpsError(
      "invalid-argument",
      "Specify fewer than 10 audience parameters."
    );
  }

  // Get the firestore instance.
  const firestore = getFirestore();

  const allUserDocsPromises: Promise<FirebaseFirestore.QuerySnapshot<DocumentData>["docs"]>[] = [];
  for (let i = 0; i < notificationAudiences.length; i++) {
    logger.debug(`Making filter for audience ${i + 1}.`);

    let usersQuery: Query = firestore.collection("users");

    const queriesToProcess = Object.entries(notificationAudiences[i]);

    logger.debug(`Found ${queriesToProcess.length} queries to process.`);

    const processedQueries: string[] = [];
    for (let j = 0; j < queriesToProcess.length; j++) {
      const [field, allowedValues] = queriesToProcess[j];
      if (allowedValues.length === 1) {
        logger.debug(`Using == query for ${field} because there is only one value.`);
        usersQuery = usersQuery.where(new FieldPath("attributes", field), "==", allowedValues[0]);
        processedQueries.push(field);
      }
    }

    const audiencesBySpecificity = [
      "committee",
      "committeeRank",
      "spiritTeamId",
      "spiritCaptain",
      "dbRole",
      "marathonAccess"
    ];

    for (let j = 0; j < audiencesBySpecificity.length; j++) {
      const field = audiencesBySpecificity[j];
      if (field in notificationAudiences[i] && !processedQueries.includes(field)) {
        logger.debug(`Using in query for ${field} because it is the most specific.`);
        usersQuery = usersQuery.where(new FieldPath("attributes", field), "in", notificationAudiences[i][field]);
        processedQueries.push(field);
        break;
      }
    }

    if (processedQueries.length < queriesToProcess.length) {
      logger.debug("There are still queries to process, will filter in code.");

      allUserDocsPromises.push(usersQuery.get().then((querySnapshot) => querySnapshot.docs.filter((doc) => {
        for (let j = 0; j < queriesToProcess.length; j++) {
          const [field, allowedValues] = queriesToProcess[j];
          if (!processedQueries.includes(field) && !allowedValues.includes(String(doc.get(new FieldPath("attributes", field))))) {
            return false;
          }
        }
        return true;
      })));
    } else {
      logger.debug("All queries were included in the in query, using returned docs directly.");
      allUserDocsPromises.push(usersQuery.get().then((querySnapshot) => querySnapshot.docs));
    }
  }
  return (await Promise.all(allUserDocsPromises)).flat();
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
      logger.error(`Push token ${pushToken as string} is not a valid Expo push token`);
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
      throw new https.HttpsError(
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
