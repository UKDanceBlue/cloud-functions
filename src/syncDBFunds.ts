import * as functions from "firebase-functions";
import { getFirestore } from "firebase-admin/firestore";

import fetch from "node-fetch";

type DbFundsEntry = {
  DbNum: string;
  Active: boolean;
  Total: number;
};
function isValidDbFundsEntry(entryParam: unknown): entryParam is DbFundsEntry {
  const entry = entryParam as { [key: string]: unknown };
  return (
    typeof entry.DbNum === "string" &&
    typeof entry.Active === "boolean" &&
    typeof entry.Total === "number"
  );
}

async function queryDbFunds(fiscalYear: string, authToken: string): Promise<unknown> {
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
  return response.json();
}

export default functions.pubsub.schedule("every 24 hours").onRun(async () => {
  // Get config info from firebase
  const dbFundsSyncConfig = (await getFirestore().doc("configs/db-funds-sync").get()).data();
  if (!dbFundsSyncConfig) {
    functions.logger.error("db-funds-sync config not set");
    return;
  }

  const currentFiscalYears = dbFundsSyncConfig.currentFiscalYears as unknown;
  const authToken = dbFundsSyncConfig.authToken as unknown;

  // Check types for dbFundsSyncConfig
  if (!Array.isArray(currentFiscalYears)) {
    functions.logger.error("currentFiscalYears is not an array");
    return;
  }
  if (typeof authToken !== "string") {
    functions.logger.error("authToken is not a string");
    return;
  }

  // A map of active teams and their totals to be loaded from the database
  const teamTotals: { [key: string]: number } = {};
  if (Array.isArray(currentFiscalYears)) {
    for (const fiscalYear of currentFiscalYears) {
      if (typeof fiscalYear !== "string") {
        functions.logger.error(
          "A value of fiscalYears is not a string",
          JSON.stringify(fiscalYear)
        );
        continue;
      }

      let dbFundsData;

      try {
        dbFundsData = (await queryDbFunds(fiscalYear, authToken)) as object;
        if (!dbFundsData) {
          functions.logger.error(`No data returned for fiscal year ${fiscalYear}`);
          continue;
        }
        // Make sure data's members are good (DbNum is a string, Active is a boolean, and Total is a number)
        if (!Array.isArray(dbFundsData)) {
          functions.logger.error("dbFundsData is not an array", dbFundsData);
          continue;
        }
      } catch (error) {
        functions.logger.error(
          `Error when fetching data from fiscal year ${fiscalYear}`,
          `Skipping fiscal year ${fiscalYear}.`
        );
        continue;
      }

      for (let i = 0; i < dbFundsData.length; i++) {
        const entry = dbFundsData[i] as unknown;
        if (!isValidDbFundsEntry(entry)) {
          functions.logger.error(
            `Invalid data entry in fiscal year ${fiscalYear}`,
            JSON.stringify(dbFundsData[i])
          );
          continue;
        }
        // Ensure that each element of the array has a team name and is active
        if (entry.DbNum !== null && entry.DbNum !== undefined) {
          if (entry.Active) {
            if (teamTotals[entry.DbNum]) {
              // If the team had a total stored in the last fiscal year, just add to it
              teamTotals[entry.DbNum] = teamTotals[entry.DbNum] + entry.Total;
            } else {
              // Otherwise create a spot for them
              teamTotals[entry.DbNum] = entry.Total;
            }
          }
        } else {
          functions.logger.info(
            `Error when trying to parse element ${i} of fiscal year ${fiscalYear}: *element is invalid*.`,
            `Skipping element ${i}.`,
            dbFundsData
          );
          continue;
        }
      }
    }
  }

  const teamsCollection = getFirestore().collection("teams");

  // Get a reference to the teams collection and get an array of all the teams
  const firebaseTeams = (await teamsCollection.get()).docs.map((document) => {
    const data = document.data();
    if (!(typeof data.networkForGoodId === "string")) {
      functions.logger.error(
        `Error when trying to parse team ${document.id}: *networkForGoodId is not a string*.`,
        `Skipping team ${document.id}.`,
        data
      );
      return;
    }
    return { firebaseId: document.id, networkForGoodId: data.networkForGoodId };
  });

  for (const team of firebaseTeams) {
    if (!team) {
      functions.logger.error(
        "Error when trying to parse a team: *team is not a valid object*.",
        JSON.stringify(firebaseTeams)
      );
      continue;
    }
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
