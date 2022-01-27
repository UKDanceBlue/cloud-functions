import * as functions from "firebase-functions";
import { getFirestore, FieldValue } from "firebase-admin/firestore";

import { Expo } from "expo-server-sdk";

export default async (data, context) => {
  // !!! GATHER INPUT AND CONFIGURATION !!!
  const {
    notificationTitle,
    notificationBody,
    notificationAudiences,
    notificationData,
    matchAllAudiences,
  } = data;
  const email = context.auth?.token?.email;

  const notificationsConfig = (await getFirestore().doc("configs/notifications").get()).data();

  const devMode = !!notificationsConfig.devMode;
  if (devMode) {
    functions.logger.debug(JSON.stringify(data, undefined, 2));
    functions.logger.debug(JSON.stringify(notificationsConfig, undefined, 2));
  }

  // !!! Validate user authorization !!!
  const emails = notificationsConfig.allowedEmails;
  if (!emails.includes(email)) {
    return {
      status: "error",
      error: {
        code: "not-authorized",
        message: "Your account is not authorized to send push notifications. No action was taken.",
      },
    };
  }

  // !!! Get an array of tokens to send notifications to !!!
  const tokens = [];

  let pushTokensQuery;
  if (Array.isArray(notificationAudiences) && notificationAudiences.length > 0) {
    // Check number of audiences
    if (notificationAudiences.length > 10) {
      return {
        status: "error",
        error: {
          code: "too-many-audiences",
          message: "Due to technical limitations, you may only specify a maximum of 10 audiences.",
        },
      };
    }
    // Do the designated devices need to match all of the given audiences, or just some of them?
    if (matchAllAudiences) {
      if (devMode) {
        functions.logger.debug(
          `Trying to match all audiences, grabbing only those with ${notificationAudiences[0]}`
        );
      }
      pushTokensQuery = getFirestore()
        .collection("devices")
        /** TODO fix this, not possible until firestore has array-contains-all
         * Until that time I am just going to fetch all of
         * the devices that match the first audience (hopefully
         * the smallest) and then filter it later (see verifyMatchesAllAudiences)
         */
        .where("audiences", "array-contains", notificationAudiences[0]);
    } else {
      pushTokensQuery = getFirestore()
        .collection("devices")
        .where("audiences", "array-contains-any", notificationAudiences);
    }
  } else {
    pushTokensQuery = getFirestore()
      .collection("devices")
      .where("audiences", "array-contains", "all");
  }

  const notification = {
    sound: "default",
    title: notificationTitle || "DanceBlue",
    body: notificationBody || "",
    data: notificationData || {},
  };

  // !!! Populate usersToReceiveNotification !!!
  const usersToReceiveNotification = {};
  const snapshot = await pushTokensQuery.get();
  snapshot.forEach((snapshot) => {
    const docData = snapshot.data();
    if (docData.expoPushToken) {
      if (devMode) {
        functions.logger.debug(`device ${snapshot.id} is being checked`);
      }

      // If matchAllAudiences is set then we need to perform additional validation with verifyMatchesAllAudiences before sending a notification to that device
      if (
        !matchAllAudiences ||
        verifyMatchesAllAudiences(notificationAudiences, docData, devMode, snapshot.id)
      ) {
        if (devMode) {
          functions.logger.debug(`device ${snapshot.id} will be sent a notification`);
        }

        tokens.push(docData.expoPushToken);
        usersToReceiveNotification[docData.expoPushToken] = getFirestore().doc(
          `users/${docData.latestUser}`
        );
      }
    }
  });

  // Create a new Expo SDK client
  const expo = new Expo({ accessToken: notificationsConfig.expoAccessToken });

  // !! Create the messages that you want to send to clients !!
  const messages = [];
  for (const pushToken of tokens) {
    // Each push token should look like "ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]"
    if (!Expo.isExpoPushToken(pushToken)) {
      functions.logger.error(`Push token ${pushToken} is not a valid Expo push token`);
    } else {
      // Construct a message (see https://docs.expo.io/push-notifications/sending-notifications/)
      messages.push({ to: pushToken, ...notification });
    }
  }

  // The Expo push notification service accepts batches of notifications so
  // that you don't need to send 1000 requests to send 1000 notifications. We
  // recommend you batch your notifications to reduce the number of requests
  // and to compress them (notifications with similar content will get
  // compressed).
  const chunks = expo.chunkPushNotifications(messages);
  if (devMode) {
    functions.logger.debug(`About to try to send ${chunks.length} chunks`);
  }

  const response = {
    status: "OK",
    error: [],
    successfulTickets: 0,
    failedTickets: 0,
  };

  // !!! Send the messages to Expo's servers and check for errors !!!
  const { errors: chunkErrors, tickets } = await sendChunks(chunks, expo, devMode);
  response.error.push(...chunkErrors);
  for (let i = 0; i < chunkErrors.length; i++) {
    if (chunkErrors[i]?.status === "error") {
      const message = chunkErrors[i]?.message;
      const details = chunkErrors[i]?.details;

      let failedPushToken;
      if (typeof message === "string") {
        failedPushToken = message.substring(
          message.indexOf("ExponentPushToken["),
          message.indexOf("]") + 1
        );
      }

      switch (details?.error) {
        case "DeviceNotRegistered": {
          const deletedSuccessfully =
            failedPushToken && (await deletePushTokenFromFirebase(failedPushToken));

          response.error.push({
            failedPushToken,
            code: "device-not-registered",
            message: deletedSuccessfully ? "Token deleted" : "Failed to delete token",
          });
          break;
        }
        default:
          return {
            status: "error",
            error: {
              code: "unhandled-internal-error",
              message: details.error,
            },
          };
      }
    }
  }

  if (devMode) {
    functions.logger.debug(
      "It seems like sending notifications with Expo went well, adding to past-notifications"
    );
  }
  // If no exception:
  await addNotificationToUserDocuments(notification, devMode, usersToReceiveNotification);

  if (devMode) {
    functions.logger.debug("Done adding record to Firestore, moving on to checking receipts");
  }

  // Handle notification receipts
  const receiptIds = [];
  for (let i = 0; i < tickets.length; i++) {
    // NOTE: Not all tickets have IDs; for example, tickets for notifications
    // that could not be enqueued will have error information and no receipt ID.
    if (tickets[i].id) {
      receiptIds.push(tickets[i].id);
    }
  }

  const receiptIdChunks = expo.chunkPushNotificationReceiptIds(receiptIds);
  // Like sending notifications, there are different strategies you could use
  // to retrieve batches of receipts from the Expo service.
  for (let i = 0; i < receiptIdChunks.length; i++) {
    try {
      const receipts = await expo.getPushNotificationReceiptsAsync(receiptIdChunks[i]);
      if (devMode) {
        functions.logger.debug(`Got set ${i} of ${receiptIdChunks.length} of receipts`);
      }

      // The receipts specify whether Apple or Google successfully received the
      // notification and information about an error, if one occurred.
      for (let i = 0; i < receipts.length; i++) {
        const { message, details } = receipts[i];
        if (details?.error) {
          response.failedTickets++;

          let failedPushToken;
          if (typeof message === "string") {
            failedPushToken = message.substring(
              message.indexOf("ExponentPushToken["),
              message.indexOf("]") + 1
            );
          }

          switch (details.error) {
            case "DeviceNotRegistered": {
              const deletedSuccessfully =
                failedPushToken && (await deletePushTokenFromFirebase(failedPushToken));

              response.error.push({
                failedPushToken,
                code: "device-not-registered",
                message: deletedSuccessfully ? "Token deleted" : "Failed to delete token",
              });
              break;
            }
            case "MessageTooBig":
              response.error.push({
                failedPushToken,
                code: "message-too-big",
              });
              break;
            case "MessageRateExceeded":
            default:
              return {
                status: "error",
                error: {
                  failedPushToken,
                  code: "unhandled-internal-error",
                  message: details.error,
                },
              };
          }
        } else {
          response.successfulTickets++;
        }
      }
    } catch (error) {
      console.error(error);
    }
  }

  return response;
};

/**
 * TERRIBLENESS HERE
 * Verify if a user matches all given audiences, this is needed for the reasons explained above it's call
 * @param {string[]} notificationAudiences Array of valid attribute strings to limit the audience selection to
 * @param {object} docData Object representing the user's Firestore document
 * @param {string} docId The user's document ID
 * @param {boolean} devMode Should log messages be printed
 * @return {boolean} Whether the given user matches all notification audiences
 */
function verifyMatchesAllAudiences(notificationAudiences, docData, docId, devMode) {
  let isDeviceInAllAudiences = true;
  // Iterate though every audience the device needs (except the first, which we already checked up above)
  for (let i = 1; i < notificationAudiences.length; i++) {
    let isDeviceInAudience = false;
    // Iterate though every audience the device has
    for (let j = 0; j < docData.audiences.length; j++) {
      // If the device has this audience, mark it as such and bail out
      if (notificationAudiences[i] === docData.audiences[j]) {
        if (devMode) {
          functions.logger.debug(`device ${docId} has attribute '${notificationAudiences[i]}'`);
        }
        isDeviceInAudience = true;
        break;
      }
    }
    // If the device does not have a needed audience, mark it as such and bail out
    if (!isDeviceInAudience) {
      if (devMode) {
        functions.logger.debug(
          `device ${docId} was disqualified because it does not have attribute '${notificationAudiences[i]}'`
        );
      }
      isDeviceInAllAudiences = false;
      break;
    }
  }
  return isDeviceInAllAudiences;
}

/**
 * Add a notification to firebase and store a reference to that newly created document to all users who received it
 * @param {object} notification An object containing the information to be stored in the FireStore
 * @param {{string: DocumentReference}} usersToReceiveNotification An object mapping push tokens to users
 * @param {boolean} devMode Should log messages be printed
 */
async function addNotificationToUserDocuments(notification, usersToReceiveNotification, devMode) {
  const pastNotificationsCollection = getFirestore().collection("past-notifications");
  const notificationDocumentRef = await pastNotificationsCollection.add({
    title: notification.title,
    body: notification.body,
    data: notification.data,
    sound: notification.sound,
    sendTime: FieldValue.serverTimestamp(),
  });
  if (devMode) {
    functions.logger.debug(`Added a record of the notification to ${notificationDocumentRef.path}`);
  }
  // Add past notifications to each user's profile (uniquely, hence the set)
  const users = new Set(Object.values(usersToReceiveNotification)).values();

  const userPastNotificationPromises = [];
  for (let i = 0; i < users.length; i++) {
    userPastNotificationPromises.push(
      users[i].update({
        pastNotifications: FieldValue.arrayUnion(notificationDocumentRef),
      })
    );
  }

  await Promise.allSettled(userPastNotificationPromises);
  if (devMode) {
    functions.logger.debug(
      "Added a reference to the past-notifications record to all users who should have received it"
    );
  }
}

/**
 *
 * @param {Array.<ExpoPushMessage[]>} chunks A 2D array of notifications
 * @param {Expo} expo An instance of the Expo class with an accessToken set
 * @param {boolean} devMode Should log messages be printed
 * @return {Promise<{ errors: string[], tickets: string[] }>} The tickets produced by *expo.sendPushNotificationsAsync*
 */
async function sendChunks(chunks, expo, devMode) {
  const tickets = [];
  const errors = [];
  // RETURN VALUE
  // Send the chunks to the Expo push notification service. There are
  // different strategies you could use. A simple one is to send one chunk at a
  // time, which nicely spreads the load out over time:
  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    // This is fine because there should rarely ever be more than one or two chunks, I doubt this will ever slow us down much and the simplicity is worth it
    // eslint-disable-next-line no-await-in-loop
    const ticketChunk = await expo.sendPushNotificationsAsync(chunk).catch((error) => {
      functions.logger.error("Unhandled error when sending a notification chunk:", error);
      errors.push(error);
    });

    if (devMode) {
      functions.logger.info("Sent notification chunk:", ticketChunk);
    }
    tickets.push(...ticketChunk);
    // NOTE: If a ticket contains an error code in ticket.details.error, you
    // must handle it appropriately. The error codes are listed in the Expo
    // documentation:
    // https://docs.expo.io/push-notifications/sending-notifications/#individual-errors
  }
  return { errors, tickets };
}

/**
 * Search for and delete a given Expo push token from the devices collection in Firestore
 * @param {string} token A well formatted expo push token
 * @return {Promise<boolean>} Was the token deleted successfully
 */
async function deletePushTokenFromFirebase(token) {
  try {
    const query = getFirestore().collection("devices").where("expoPushToken", "==", token);
    const snapshots = await query.get();
    if (snapshots.empty) {
      return false;
    }
    snapshots.forEach((snapshot) => snapshot.ref.update("expoPushToken", null));
    return true;
  } catch {
    return false;
  }
}
