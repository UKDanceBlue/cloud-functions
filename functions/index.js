// The Cloud Functions for Firebase SDK to create Cloud Functions and set up triggers.
import * as functions from "firebase-functions";
// The Firebase Admin SDK to access Firestore.
import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";

import { Expo } from "expo-server-sdk";

import fetch from "node-fetch";

initializeApp({ projectId: "react-danceblue" });

export const sendPushNotification = functions.https.onCall(async (data, context) => {
  const { notificationTitle, notificationBody, notificationData, notificationTtl } = data;
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

  const pushTokensDbRef = getFirestore().collection("expo-push-tokens");
  // RETURN VALUE
  return await pushTokensDbRef.get().then(async (snapshot) => {
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

export const sweepOldAccounts = functions.https.onRequest(async (req, res) => {
  const response = { status: undefined, usersDeleted: [], errors: [] };

  const annonCutoffDate = new Date();
  annonCutoffDate.setDate(annonCutoffDate.getDate() - 3);

  const linkBlueCutoffDate = new Date();
  linkBlueCutoffDate.setDate(linkBlueCutoffDate.getDate() - 370);

  const listAllUsers = async (nextPageToken) => {
    // List batch of users, 1000 at a time.
    await getAuth()
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
  await listAllUsers();

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
          if (json[i].DbNum !== null && json[i].DbNum !== undefined) {
            if (json[i].Active) {
              if (teamTotals[json[i].DbNum]) {
                // If the team had a total stored in the last fiscal year, just add to it
                teamTotals[json[i].DbNum] = teamTotals[json[i].DbNum] + json[i].Total;
              } else {
                // Otherwise create a spot for them
                teamTotals[json[i].DbNum] = json[i].Total;
              }
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

  console.log(teamTotals);

  const teamsCollection = getFirestore().collection("teams");

  // Get a reference to the teams collection and get an array of all the teams
  const firebaseTeams = (await teamsCollection.get()).docs.map((document) => {
    const data = document.data();
    return { firebaseId: document.id, networkForGoodId: data.networkForGoodId };
  });

  for (const team of firebaseTeams) {
    // Only try to load data if there is data to load
    if (teamTotals[team.networkForGoodId]) {
      await teamsCollection
        // Enter the confidential subcollection that is under the team's main collection
        .doc(team.firebaseId)
        .collection("confidential")
        .doc("fundraising")
        // Set the individual points to the raw data that was passed from the spreadsheet; this will probably be an issue but we'll see
        // This will also wipe out the document's previous value
        .set({ total: teamTotals[team.networkForGoodId] })
        .catch((reason) => {
          functions.logger.error(
            `Error when loading data to firebase team ${team.firebaseId}, data may be corrupt. Error: `,
            reason
          );
        });
    } else {
      // The team is in firebase, but not the spreadsheet
      functions.logger.info(
        `The firebase team ${team.firebaseId} was not included in the sync data, consider deleting it.`
      );
    }
  }
});

export const importSpiritPoints = functions.https.onRequest(async (req, res) => {
  /*
   * 'points' should be in the following form:
   * {
   *   "A Team": [
   *     {
   *       "rdig538": 6,
   *       "ghbd763": 15
   *     },
   *     21
   *   ],
   *   "Another Team": [
   *     {
   *       "yfyu384": 45,
   *       "dfuo242": 14
   *     },
   *     59
   *   ]
   * }
   */
  try {
    // Make sure a token was sent
    if (!req.get("X-AuthToken")) {
      res.sendStatus(401);
    }
    // Make sure it's the right token
    else if (
      req.get("X-AuthToken") !==
      (await getFirestore().collection("configs").doc("db-spirit-spreadsheet-sync").get()).get(
        "AuthToken"
      )
    ) {
      res.sendStatus(403);
    }

    // Convenience
    const points = req.body;
    const teamsCollection = getFirestore().collection("teams");

    // Get a reference to the teams collection and get an array of all the teams
    const firebaseTeams = (await teamsCollection.get()).docs.map((document) => {
      const data = document.data();
      return { firebaseId: document.id, spiritSpreadsheetId: data.spiritSpreadsheetId };
    });

    const responseData = {};
    for (const team of firebaseTeams) {
      // Only try to load data if there is data to load
      if (points[team.spiritSpreadsheetId]) {
        // Check types
        if (
          typeof points[team.spiritSpreadsheetId][0] !== "object" ||
          typeof points[team.spiritSpreadsheetId][1] !== "number"
        ) {
          responseData[team.spiritSpreadsheetId] = {
            firebaseId: team.firebaseId,
            success: false,
            reason: "Invalid data;nrequest aborted",
          };
          functions.logger.error(
            `Invalid data attempted to sync to firebase team ${team.firebaseId}. No changes were made and the request was aborted.`
          );
          res.status(400).send(responseData).end();
          continue;
        }
        await teamsCollection
          // Start off in the confidential subcollection that is under the team's main collection
          .doc(team.firebaseId)
          .collection("confidential")
          .doc("individualSpiritPoints")
          // Set the individual points to the raw data that was passed from the spreadsheet; this will probably be an issue but we'll see
          // This will also wipe out the document's previous value
          .set(points[team.spiritSpreadsheetId][0])
          // After that is done we move onto the total
          .then(() =>
            teamsCollection
              .doc(team.firebaseId)
              // Merge the total points into the team's regular, nonconfidential, collection
              .set({ totalSpiritPoints: points[team.spiritSpreadsheetId][1] }, { merge: true })
              .then(
                // After we are done with both of those, add a message to the resonse indicating success
                () =>
                  (responseData[team.spiritSpreadsheetId] = {
                    firebaseId: team.firebaseId,
                    success: true,
                  })
              )
              .catch((reason) => {
                // Some kind of error, indicate it in the response and log a message
                responseData[team.spiritSpreadsheetId] = {
                  firebaseId: team.firebaseId,
                  success: false,
                  cause: reason,
                };
                functions.logger.error(
                  `Error when loading data to firebase team ${team.firebaseId}, data may be corrupt. Error: `,
                  reason
                );
              })
          )
          .catch((reason) => {
            // Some kind of error, indicate it in the response and log a message
            responseData[team.spiritSpreadsheetId] = {
              firebaseId: team.firebaseId,
              success: false,
              cause: reason,
            };
            functions.logger.error(
              `Error when loading data to firebase team ${team.firebaseId}, data may be corrupt. Error: `,
              reason
            );
          });
      } else {
        // The team is in firebase, but not the spreadsheet
        functions.logger.info(
          `The firebase team ${team.firebaseId} was not included in the sync data, consider deleting it or adding it to the spreadsheet.`
        );
      }
    }
    // Finish up
    res.status(200).send(responseData).end();
  } catch (err) {
    functions.logger.error("An error occurred and the function was aborted", err);
    // Something, somewhere, threw an error
    res.status(500).send(err).end();
  }
});
