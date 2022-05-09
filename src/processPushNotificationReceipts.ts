import * as functions from "firebase-functions";
import Expo, { ExpoPushReceipt } from "expo-server-sdk";

// Later, after the Expo push notification service has delivered the
// notifications to Apple or Google (usually quickly, but allow the the service
// up to 30 minutes when under load), a "receipt" for each notification is
// created. The receipts will be available for at least a day; stale receipts
// are deleted.
//
// The ID of each receipt is sent back in the response "ticket" for each
// notification. In summary, sending a notification produces a ticket, which
// contains a receipt ID you later use to get the receipt.
//
// The receipts may contain error codes to which you must respond. In
// particular, Apple or Google may block apps that continue to send
// notifications to devices that have blocked notifications or have uninstalled
// your app. Expo does not control this policy and sends back the feedback from
// Apple and Google so you can handle it appropriately.

export type ProcessPushNotificationReceiptsArgument = {
  receiptIds: string[];
};

export default functions
  .runWith({ secrets: ["EXPO_ACCESS_TOKEN"] })
  .https.onCall(async (data: ProcessPushNotificationReceiptsArgument) => {
    const { receiptIds } = data;
    if (!Array.isArray(receiptIds)) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "The function must be called with an object containing the string array 'receiptIds'."
      );
    }

    const EXPO_ACCESS_TOKEN = process.env.EXPO_ACCESS_TOKEN;

    if (!EXPO_ACCESS_TOKEN) {
      throw new functions.https.HttpsError(
        "failed-precondition",
        "The Expo access token is not set."
      );
    }

    const expo = new Expo({ accessToken: process.env.EXPO_ACCESS_TOKEN });

    const receiptIdChunks = expo.chunkPushNotificationReceiptIds(receiptIds);

    const receipts = {} as { [key: string]: ExpoPushReceipt | null };

    receiptIds.forEach((receiptId) => {
      receipts[receiptId] = null;
    });

    for (const chunk of receiptIdChunks) {
      try {
        const receiptsFromChunk = await expo.getPushNotificationReceiptsAsync(chunk);

        // The receipts specify whether Apple or Google successfully received the
        // notification and information about an error, if one occurred.
        Object.entries(receiptsFromChunk).forEach(({ 0: receiptId, 1: receipt }) => {
          // TODO handle DeviceNotRegistered (and maybe MessageRateExceeded) here, all other errors go back to the client
          receipts[receiptId] = receipt;
        });
      } catch (error) {
        functions.logger.error(error);
        return { status: "partial-failure", receipts };
      }
    }

    return { status: "ok", receipts };
  });
