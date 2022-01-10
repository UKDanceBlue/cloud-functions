import * as functions from "firebase-functions";
import { getFirestore, FieldValue } from "firebase-admin/firestore";

import { Expo } from "expo-server-sdk";

export default async (data, context) => {
  const { notificationTitle, notificationBody, notificationAudiences, notificationData } = data;
  const email = context.auth?.token?.email;

  const notificationsConfig = (await getFirestore().doc("configs/notifications").get()).data();
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
  if (Array.isArray(notificationAudiences) && !(notificationAudiences.length === 0)) {
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
    pushTokensQuery = getFirestore()
      .collection("devices")
      .where("audience", "in", notificationAudiences);
  } else {
    pushTokensQuery = getFirestore()
      .collection("devices")
      .where("audiences", "array-contains-any", ["all"]);
  }

  const notification = {
    sound: "default",
    title: notificationTitle || "DanceBlue",
    body: notificationBody || "",
    data: notificationData || {},
  };
  const devicesToRecieveNotification = {};

  // RETURN VALUE
  return await pushTokensQuery.get().then(async (snapshot) => {
    snapshot.forEach((doc) => {
      const docData = doc.data();
      if (docData.expoPushToken) {
        tokens.push(docData.expoPushToken);
        devicesToRecieveNotification[docData.expoPushToken] = doc.ref;
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
          functions.logger.info("Sending notification chunck:", ticketChunk);
          tickets.push(...ticketChunk);
          // NOTE: If a ticket contains an error code in ticket.details.error, you
          // must handle it appropriately. The error codes are listed in the Expo
          // documentation:
          // https://docs.expo.io/push-notifications/sending-notifications/#individual-errors
        } catch (error) {
          functions.logger.error("Error when sending a notification chunck:", error);
          for (let i = 0; i < chunk.length; i++) {
            delete devicesToRecieveNotification[chunk[i]];
          }
          // RETURN VALUE on exception
          return {
            status: "error",
            error,
          };
        }
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
          for (const device in devicesToRecieveNotification) {
            if (Object.prototype.hasOwnProperty.call(devicesToRecieveNotification, device)) {
              await devicesToRecieveNotification[device].update({
                pastNotifications: FieldValue.arrayUnion(notificationDocumentRef),
              });
            }
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
