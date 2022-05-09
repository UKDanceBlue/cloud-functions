import { initializeApp } from "firebase-admin/app";

import sendPushNotificationFunction, {
  SendPushNotificationArgument,
} from "./src/sendPushNotification.js";
import processPushNotificationReceiptsFunction, {
  ProcessPushNotificationReceiptsArgument,
} from "./src/processPushNotificationReceipts.js";
import sweepOldAccountsFunction from "./src/sweepOldAccounts.js";
import syncDBFundsFunction from "./src/syncDBFunds.js";
import writeLogFunction from "./src/writeLog.js";
import updateUserClaimsFunction from "./src/updateUserClaims.js";
import handleDeviceDocumentWriteFunction from "./src/handleDeviceDocumentWrite.js";
import { Runnable } from "firebase-functions/v1";

// TODO type all of these using CloudFunction and HttpsFunction by creating a with argument types for all of these functions

initializeApp({ projectId: "react-danceblue" });

export const sendPushNotification: Runnable<SendPushNotificationArgument> =
  sendPushNotificationFunction;

export const processPushNotificationReceipts: Runnable<ProcessPushNotificationReceiptsArgument> =
  processPushNotificationReceiptsFunction;

export const sweepOldAccounts = sweepOldAccountsFunction;

export const syncDBFunds = syncDBFundsFunction;

export const writeLog = writeLogFunction;

export const updateUserClaims: Runnable<void> = updateUserClaimsFunction;

export const handleDeviceDocumentWrite = handleDeviceDocumentWriteFunction;
