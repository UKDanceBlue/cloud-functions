import * as functions from "firebase-functions";
import { getFirestore } from "firebase-admin/firestore";

export default async (req, res) => {
  /*
   * 'points' should be in the following form:
   * {
   *   "A Team": [
   *     {
   *       "rdig538": {name: "Roy Digsy", value: 6},
   *       "ghid763": {name: "Gill Hibbon", value: 15}
   *     },
   *     21
   *   ],
   *   "Another Team": [
   *     {
   *       "yfyu384": {name: "Yuri Fyuido", value: 45},
   *       "dfon242": {name: "Dan Fondue", value: 14}
   *     },
   *     59
   *   ]
   * }
   */
  const responseData = {};
  try {
    // Make sure a token was sent
    if (!req.get("X-AuthToken")) {
      res.sendStatus(401).end();
      return;
    }
    // Make sure it's the right token
    else if (
      req.get("X-AuthToken") !==
      (await getFirestore().collection("configs").doc("db-spirit-spreadsheet-sync").get()).get(
        "AuthToken"
      )
    ) {
      res.sendStatus(403).end();
      return;
    }

    // Convenience
    const sheetData = req.body;
    const teamsCollection = getFirestore().collection("teams");

    // Get a reference to the teams collection and get an array of all the teams
    const firebaseTeams = (
      await teamsCollection.get().catch((err) => res.status(500).send(err).end())
    ).docs.map((document) => {
      const data = document.data();
      return { firebaseId: document.id, spiritSpreadsheetId: data.spiritSpreadsheetId };
    });

    for (const team of firebaseTeams) {
      // Only try to load data if there is data to load
      if (sheetData[team.spiritSpreadsheetId]) {
        functions.logger.debug(sheetData[team.spiritSpreadsheetId]);
        // Check types
        if (
          typeof sheetData[team.spiritSpreadsheetId][0] !== "object" ||
          typeof sheetData[team.spiritSpreadsheetId][1] !== "number"
        ) {
          responseData[team.spiritSpreadsheetId] = {
            firebaseId: team.firebaseId,
            success: false,
            reason: "Invalid data;nrequest aborted",
          };
          functions.logger.error(
            `Invalid data attempted to sync to firebase team ${team.firebaseId}. No changes were made and the request was aborted.`
          );
          res.status(400).send(responseData);
          continue;
        }

        const points = {};
        const names = {};

        for (const linkblue in sheetData[team.spiritSpreadsheetId][0]) {
          if (
            Object.prototype.hasOwnProperty.call(sheetData[team.spiritSpreadsheetId][0], linkblue)
          ) {
            points[linkblue] = sheetData[team.spiritSpreadsheetId][0][linkblue]?.value;
            names[linkblue] = sheetData[team.spiritSpreadsheetId][0][linkblue]?.name;
          } else {
            functions.logger.warn(
              `Error when loading data to firebase team ${team.firebaseId}, data may be corrupt. Error found at: `,
              sheetData[linkblue][0]
            );
          }
        }

        let setNamesError;
        await teamsCollection
          .doc(team.firebaseId)
          .set({ members: names }, { mergeFields: ["members"] })
          .catch((reason) => {
            setNamesError = reason;
            functions.logger.error(
              `Error when loading members to firebase team ${team.firebaseId}, data may be corrupt. Error: `,
              reason
            );
          });
        if (setNamesError) {
          res.setHeader("firebase-error", JSON.stringify(setNamesError)).sendStatus(500);
          return;
        }

        await teamsCollection
          // Start off in the confidential subcollection that is under the team's main collection
          .doc(team.firebaseId)
          .collection("confidential")
          .doc("individualSpiritPoints")
          // Set the individual points to the raw data that was passed from the spreadsheet; this will probably be an issue but we'll see
          // This will also wipe out the document's previous value
          .set(points)
          // After that is done we move onto the total
          .then(() =>
            teamsCollection
              .doc(team.firebaseId)
              // Merge the total points into the team's regular, nonconfidential, collection
              .set(
                { totalSpiritPoints: sheetData[team.spiritSpreadsheetId][1] },
                { mergeFields: ["totalSpiritPoints"] }
              )
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
                  `Error when loading points to firebase team ${team.firebaseId}, data may be corrupt. Error: `,
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
              `Error when loading points to firebase team ${team.firebaseId}, data may be corrupt. Error: `,
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
    res.status(200).send(responseData);
  } catch (err) {
    functions.logger.error("An error occurred and the function was aborted", err);
    // Something, somewhere, threw an error
    res.status(500).send(err);
  } finally {
    res.end();
  }
};
