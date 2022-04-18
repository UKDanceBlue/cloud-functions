import * as functions from "firebase-functions";
import { initializeApp } from "firebase-admin/app";

import sendPushNotificationFunction from "./sendPushNotification.js";
import processPushNotificationReceiptsFunction from "./processPushNotificationReceipts.js";
import sweepOldAccountsFunction from "./sweepOldAccounts.js";
import syncDBFundsFunction from "./syncDBFunds.js";
import importSpiritPointsFunction from "./importSpiritPoints.js";
import writeLogFunction from "./writeLog.js";
import updateTeamFunction from "./updateTeam.js";
import updateUserClaimsFunction from "./updateUserClaims.js";
import handleDeviceDocumentWriteFunction from "./handleDeviceDocumentWrite.js";

initializeApp({ projectId: "react-danceblue" });

export const sendPushNotification = functions
  .runWith({ secrets: ["EXPO_ACCESS_TOKEN"] })
  .https.onCall(sendPushNotificationFunction);

export const processPushNotificationReceipts = processPushNotificationReceiptsFunction;

export const sweepOldAccounts = functions.https.onRequest(sweepOldAccountsFunction);

export const syncDBFunds = functions.pubsub.schedule("every 24 hours").onRun(syncDBFundsFunction);

export const importSpiritPoints = functions.https.onRequest(importSpiritPointsFunction);

export const writeLog = functions.https.onRequest(writeLogFunction);

export const updateTeam = functions.https.onCall(updateTeamFunction);

export const updateUserClaims = functions.https.onCall(updateUserClaimsFunction);

export const handleDeviceDocumentWrite = handleDeviceDocumentWriteFunction;
