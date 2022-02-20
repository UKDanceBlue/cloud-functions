import * as functions from "firebase-functions";
import { getFirestore } from "firebase-admin/firestore";

import fetch from "node-fetch";

export default async () => {
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
          `https://dancebluefunds.uky.edu/api/report/teamtotals/${fiscalYear}`,
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
};
