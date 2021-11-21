// The Cloud Functions for Firebase SDK to create Cloud Functions and set up triggers.
import * as functions from "firebase-functions";
// The Firebase Admin SDK to access Firestore.
import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";

import { Expo } from "expo-server-sdk";

initializeApp();

export const sendPushNotification = functions.https.onCall(async (data, context) => {
  const { notificationTitle, notificationBody, notificationData, notificationTtl } = data;
  const { email } = context.auth.token;

  const notificationsConfig = await getFirestore().doc("configs/notifications").get();
  const emails = notificationsConfig.get("allowedEmails");
  if (!emails.includes(email)) {
    return {
      status: "error",
      error: {
        code: "email-not-authorized",
        message: "Your account is not authorized to send push notifications. No action was taken.",
      },
    };
  }

  const tokens = [];

  const pushTokensDbRef = getFirestore().collection("expo-push-tokens");
  // RETURN VALUE
  return await pushTokensDbRef.get().then((snapshot) => {
    snapshot.forEach((doc) => {
      tokens.push(doc.data().token);
    });

    // Create a new Expo SDK client
    // optionally providing an access token if you have enabled push security
    const expo = new Expo(); // { accessToken: process.env.EXPO_ACCESS_TOKEN }

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
        messages.push({
          to: pushToken,
          sound: "default",
          title: notificationTitle || "DanceBlue",
          body: notificationBody || "",
          data: notificationData || {},
          ttl: notificationTtl || undefined,
        });
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
      // eslint-disable-next-line no-restricted-syntax
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
          // RETURN VALUE on exception
          return {
            status: "error",
            error,
          };
        }
      }
      // RETURN VALUE if no exception
      return {
        status: "OK",
          tickets,
      };
    })();
  });
});
        })
        .end()
    );
  });
});
