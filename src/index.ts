import { applicationDefault, initializeApp } from "firebase-admin/app";
import { Runnable } from "firebase-functions/v1";

import generateCustomTokenFunction from "./generateCustomToken.js";
import handleDeviceDocumentWriteFunction from "./handleDeviceDocumentWrite.js";
import processPushNotificationReceiptsFunction, {
  ProcessPushNotificationReceiptsArgument,
} from "./processPushNotificationReceipts.js";
import sendPushNotificationFunction, {
  SendPushNotificationArgument,
} from "./sendPushNotification.js";
import sweepOldAccountsFunction from "./sweepOldAccounts.js";
import syncDBFundsFunction from "./syncDBFunds.js";
import writeLogFunction from "./writeLog.js";

// TODO type all of these using CloudFunction and HttpsFunction by creating a with argument types for all of these functions

// eslint-disable-next-line @typescript-eslint/no-var-requires
initializeApp({ projectId: "react-danceblue", credential: applicationDefault() });

export const sendPushNotification: Runnable<SendPushNotificationArgument> =
  sendPushNotificationFunction;

export const processPushNotificationReceipts: Runnable<ProcessPushNotificationReceiptsArgument> =
  processPushNotificationReceiptsFunction;

export const sweepOldAccounts = sweepOldAccountsFunction;

export const syncDBFunds = syncDBFundsFunction;

export const writeLog = writeLogFunction;

export const handleDeviceDocumentWrite = handleDeviceDocumentWriteFunction;

export const generateCustomToken = generateCustomTokenFunction;
