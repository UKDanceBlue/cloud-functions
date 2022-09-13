import { applicationDefault, initializeApp } from "firebase-admin/app";
import { Runnable } from "firebase-functions/v1";

import generateCustomTokenFunction from "./generateCustomToken.js";
import handleDeviceDocumentWriteFunction from "./handleDeviceDocumentWrite.js";
import handleOpportunityWriteFunction from "./handleOpportunityWrite.js";
import handleSpiritPointEntryWriteFunction from "./handleSpiritPointEntryWrite.js";
import processPushNotificationReceiptsFunction, {
  ProcessPushNotificationReceiptsArgument,
} from "./processPushNotificationReceipts.js";
import sendPushNotificationFunction, {
  SendPushNotificationArgument,
} from "./sendPushNotification.js";
import syncDBFundsFunction from "./syncDBFunds.js";

// TODO type all of these using CloudFunction and HttpsFunction by creating a with argument types for all of these functions

// eslint-disable-next-line @typescript-eslint/no-var-requires
initializeApp({ projectId: "react-danceblue", credential: applicationDefault() });

export const sendPushNotification: Runnable<SendPushNotificationArgument> =
  sendPushNotificationFunction;

export const processPushNotificationReceipts: Runnable<ProcessPushNotificationReceiptsArgument> =
  processPushNotificationReceiptsFunction;

export const syncDBFunds = syncDBFundsFunction;

export const handleDeviceDocumentWrite = handleDeviceDocumentWriteFunction;

export const generateCustomToken = generateCustomTokenFunction;

export const handleSpiritPointEntryWrite = handleSpiritPointEntryWriteFunction;

export const handleOpportunityWrite = handleOpportunityWriteFunction;
