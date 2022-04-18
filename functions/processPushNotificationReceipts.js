import * as functions from "firebase-functions";
import Expo from "expo-server-sdk";

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

export default functions
  .runWith({ secrets: ["EXPO_ACCESS_TOKEN"] })
  .https.onCall(async (data, context) => {
    const { receiptIds } = data;
    if (!Array.isArray(receiptIds)) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        "The function must be called with an object containing the string array 'receiptIds'."
      );
    }
    const expo = new Expo(process.env.EXPO_ACCESS_TOKEN);

    const receiptIdChunks = expo.chunkPushNotificationReceiptIds(receiptIds);

    const receipts = receiptIds.reduce((prev, curr) => {
      const tmp = { ...prev };
      tmp[curr] = null;
      return tmp;
    }, {});

    for (const chunk of receiptIdChunks) {
      try {
        const receiptsFromChunk = await expo.getPushNotificationReceiptsAsync(chunk);

        // The receipts specify whether Apple or Google successfully received the
        // notification and information about an error, if one occurred.
        Object.entries(receiptsFromChunk).forEach(({ 0: receiptID, 1: receipt }) => {
          // TODO handle DeviceNotRegistered (and maybe MessageRateExceeded) here, all other errors go back to the client
          receipts.push(receipt);
        });
      } catch (error) {
        functions.logger.error(error);
        return { status: "partial-failure", receipts };
      }
    }

    return { status: "ok", receipts };
  });
