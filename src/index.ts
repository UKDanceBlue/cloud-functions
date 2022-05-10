import { initializeApp } from "firebase-admin/app";
import { Runnable } from "firebase-functions/v1";

import handleDeviceDocumentWriteFunction from "./handleDeviceDocumentWrite.js";
import processPushNotificationReceiptsFunction, {
  ProcessPushNotificationReceiptsArgument,
} from "./processPushNotificationReceipts.js";
import sendPushNotificationFunction, {
  SendPushNotificationArgument,
} from "./sendPushNotification.js";
import sweepOldAccountsFunction from "./sweepOldAccounts.js";
import syncDBFundsFunction from "./syncDBFunds.js";
import updateUserClaimsFunction from "./updateUserClaims.js";
import writeLogFunction from "./writeLog.js";


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
