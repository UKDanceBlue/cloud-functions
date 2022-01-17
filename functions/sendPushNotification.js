import * as functions from "firebase-functions";
import { getFirestore, FieldValue } from "firebase-admin/firestore";

import { Expo } from "expo-server-sdk";

export default async (data, context) => {
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

  const tokens = [];

  let pushTokensQuery;
  if (Array.isArray(notificationAudiences) && notificationAudiences.length > 0) {
    if (notificationAudiences.length > 10) {
      return {
        status: "error",
        error: {
          code: "too-many-audiences",
          message:
            "Due to technical limitations, you may only speicify a maximium of 10 audiences.",
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
         * the smallest) and then filter it later (see 'TERRIBLENESS HERE')
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
  const usersToRecieveNotification = {};

  // RETURN VALUE
  return await pushTokensQuery.get().then(async (snapshot) => {
    snapshot.forEach((doc) => {
      const docData = doc.data();
      if (docData.expoPushToken) {
        if (devMode) {
          functions.logger.debug(`device ${doc.id} is being checked`);
        }
        // TERRIBLENESS HERE
        if (matchAllAudiences) {
          let isDeviceInAllAudiences = true;
          // Iterate though every audience the device needs (except the first, which we already checked up above)
          for (let i = 1; i < notificationAudiences.length; i++) {
            let isDeviceInAudience = false;
            // Iterate though every audience the device has
            for (let j = 0; j < docData.audiences.length; j++) {
              // If the device has this audience, mark it as such and bail out
              if (notificationAudiences[i] === docData.audiences[j]) {
                if (devMode) {
                  functions.logger.debug(
                    `device ${doc.id} has attribute '${notificationAudiences[i]}'`
                  );
                }
                isDeviceInAudience = true;
                break;
              }
            }
            // If the device does not have a needed audience, mark it as such and bail out
            if (!isDeviceInAudience) {
              if (devMode) {
                functions.logger.debug(
                  `device ${doc.id} was disqualified because it does not have attribute '${notificationAudiences[i]}'`
                );
              }
              isDeviceInAllAudiences = false;
              break;
            }
          }
          if (!isDeviceInAllAudiences) {
            // Don't add this device to the tokens array
            return;
          }
        }
        if (devMode) {
          functions.logger.debug(`device ${doc.id} will be sent a notification`);
        }
        tokens.push(docData.expoPushToken);
        usersToRecieveNotification[docData.expoPushToken] = getFirestore().doc(
          `users/${docData.latestUser}`
        );
      }
    });

    // Create a new Expo SDK client
    // optionally providing an access token if you have enabled push security
    const expo = new Expo({ accessToken: notificationsConfig.expoAccessToken });

    // Create the messages that you want to send to clients
    const messages = [];
    // eslint-disable-next-line no-restricted-syntax
    for (const pushToken of tokens) {
      // Each push token looks like ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]

      // Check that all your push tokens appear to be valid Expo push tokens
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
      functions.logger.debug(
        `About to try to send chunks: ${JSON.stringify(chunks, undefined, 2)}`
      );
    }
    const tickets = [];
    // RETURN VALUE
    return (async () => {
      // Send the chunks to the Expo push notification service. There are
      // different strategies you could use. A simple one is to send one chunk at a
      // time, which nicely spreads the load out over time:
      for (const chunk of chunks) {
        try {
          // eslint-disable-next-line no-await-in-loop
          const ticketChunk = await expo.sendPushNotificationsAsync(chunk);
          functions.logger.info("Sent notification chunck:", ticketChunk);
          tickets.push(...ticketChunk);
          // NOTE: If a ticket contains an error code in ticket.details.error, you
          // must handle it appropriately. The error codes are listed in the Expo
          // documentation:
          // https://docs.expo.io/push-notifications/sending-notifications/#individual-errors
        } catch (error) {
          functions.logger.error("Error when sending a notification chunck:", error);
          for (let i = 0; i < chunk.length; i++) {
            delete usersToRecieveNotification[chunk[i]];
          }
          // RETURN VALUE on exception
          return {
            status: "error",
            error,
          };
        }
      }
      if (devMode) {
        functions.logger.debug(
          "It seems like sending notifications with Expo went well, adding to past-notifications"
        );
      }
      // If no exception:
      const pastNotificationsCollection = getFirestore().collection("past-notifications");
      await pastNotificationsCollection
        .add({
          title: notification.title,
          body: notification.body,
          data: notification.data,
          sound: notification.sound,
          sendTime: FieldValue.serverTimestamp(),
        })
        .then(async (notificationDocumentRef) => {
          if (devMode) {
            functions.logger.debug(
              `Added a record of the notification to ${notificationDocumentRef.path}`
            );
          }
          // Add past notifications to each user's profile
          const users = Object.keys(usersToRecieveNotification);

          const userPastNotificationPromises = [];
          for (let i = 0; i < users.length; i++) {
            userPastNotificationPromises.push(
              usersToRecieveNotification[users[i]].update({
                pastNotifications: FieldValue.arrayUnion(notificationDocumentRef),
              })
            );
          }

          await Promise.allSettled(userPastNotificationPromises);
          if (devMode) {
            functions.logger.debug(
              "Added a reference to the past-notifications record to all users who should have recieved it"
            );
          }
        });

      // RETURN VALUE
      return {
        status: "OK",
        tickets,
      };
    })();
  });
};
