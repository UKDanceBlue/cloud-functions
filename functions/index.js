// The Cloud Functions for Firebase SDK to create Cloud Functions and set up triggers.
import * as functions from "firebase-functions";
// The Firebase Admin SDK to access Firestore.
import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";

import { Expo } from "expo-server-sdk";

import fetch from "node-fetch";

initializeApp();

export const sendPushNotification = functions.https.onCall(async (data, context) => {
  const { notificationTitle, notificationBody, notificationData, notificationTtl } = data;
  const { email } = context.auth.token;

  const notificationsConfig = await getFirestore().doc("configs/notifications").get().data;
  const emails = notificationsConfig.allowedEmails;
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

export const sweepOldAccounts = functions.https.onRequest((req, res) => {
  const response = { status: undefined, usersDeleted: [], errors: [] };

  const annonCutoffDate = new Date();
  annonCutoffDate.setDate(annonCutoffDate.getDate() - 3);

  const linkBlueCutoffDate = new Date();
  linkBlueCutoffDate.setDate(linkBlueCutoffDate.getDate() - 370);

  const listAllUsers = (nextPageToken) => {
    // List batch of users, 1000 at a time.
    getAuth()
      .listUsers(1000, nextPageToken)
      .then((listUsersResult) => {
        listUsersResult.users.forEach((userRecord) => {
          if (userRecord.providerData.length === 0) {
            if (new Date(userRecord.metadata.lastRefreshTime) < annonCutoffDate) {
              response.usersDeleted = response.usersDeleted.push(userRecord.uid);
            }
          } else if (userRecord.providerData[0].providerId === "saml.jumpcloud-demo") {
            /* Linkblue ID: saml.danceblue-firebase-linkblue-saml */
            console.log(userRecord.uid + " is linkblue");
          } else if (userRecord.providerData[0].providerId === "google.com") {
            console.log(userRecord.uid + " is google");
          }
        });
        if (listUsersResult.pageToken) {
          // List next batch of users.
          listAllUsers(listUsersResult.pageToken);
        }
      })
      .catch((error) => {
        response.status = "ERROR";
        response.errors.push(error);
        return;
      });
  };
  // Start recusively listing users from the beginning, 1000 at a time.
  listAllUsers();

  if (!(response.status === "ERROR")) {
    response.status = "OK";
  }
  res.json(response);
});

// This function will run on february 31st (it won't)
export const syncDBFunds = functions.pubsub.schedule("0 0 5 31 2 ?").onRun(async () => {
  // Get config info from firebase
  const dbFundsSyncConfig = (await getFirestore().doc("configs/db-funds-sync").get()).data();
  const currentFiscalYears = dbFundsSyncConfig.currentFiscalYears;
  const authToken = dbFundsSyncConfig.authToken;

  // A map of active teams and their totals to be loaded from the database
  const teamTotals = {};
  if (Array.isArray(currentFiscalYears)) {
    for (const fiscalYear of currentFiscalYears) {
      let json;
      try {
        // Load the given fiscal year from the database
        const response = await fetch(
          `https://dancebluefundspreview.uky.edu/api/report/teamtotals/${fiscalYear}`,
          {
            headers: {
              method: "GET",
              "X-AuthToken": authToken,
            },
          }
        );
        json = await response.json();
      } catch (error) {
        functions.logger.error(
          `Error when fetching data from fiscal year ${fiscalYear}.`,
          `Skipping fiscal year ${fiscalYear}.`,
          error
        );
        continue;
      }

      // Make sure the array is json, if not then the database probably rejected our auth token
      if (Array.isArray(json)) {
        for (let i = 0; i < json.length; i++) {
          // Ensure that each element of the array has a team name and is active
          if (json[i].Team && json[i].Active) {
            if (teamTotals[json[i].Team]) {
              // If the team had a total stored in the last fiscal year, just add to it
              teamTotals[json[i].Team] = teamTotals[json[i].Team] + json[i].Total;
            } else {
              // Otherwise create a spot for them
              teamTotals[json[i].Team] = json[i].Total;
            }
          } else {
            functions.logger.info(
              `Error when trying to parse element ${i} of fiscal year ${fiscalYear}: *element is invalid*.`,
              `Skipping element ${i}.`,
              json
            );
            continue;
          }
        }
      } else {
        functions.logger.warn(
          `Error when trying to parse fiscal year ${fiscalYear}: *response is not an array*.`,
          `Skipping fiscal year ${fiscalYear}.`,
          json
        );
        continue;
      }
    }
  }

  // Get a reference to the teams collection and get an array of all the teams
  const firebaseTeams = (await getFirestore().collection("teams").get()).docs;
  // Iterate through the array
  firebaseTeams.forEach(async (queryDocumentSnapshot) => {
    // Get team name as stored in the firebase docuement
    const teamName = queryDocumentSnapshot.get("name");
    // If the teamToals object has an element with the name of the team loaded from firebase then upload their total to firebase
    if (teamTotals[teamName]) {
      queryDocumentSnapshot.ref
        // Merge the total into the team's document
        .set({ fundraisingTotal: teamTotals[teamName] }, { merge: true })
        .then(
          (result) =>
            functions.logger.info(
              `Set *fundraisingTotal* of ${teamName} to ${teamTotals[teamName]}.`
            ),
          (reason) =>
            functions.logger.error(`Failed to set *fundraisingTotal* of ${teamName}.`, reason)
        );
    }
  });
});
