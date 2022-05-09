import { FieldValue, getFirestore } from "firebase-admin/firestore";
import * as functions from "firebase-functions";

export default functions.firestore.document("devices/{deviceId}").onWrite(async (change) => {
  // Get firestore
  const firestore = getFirestore();
  // Get an object with the current document value.
  // If the document does not exist, it has been deleted.
  const updatedDocument = change.after.exists ? change.after.data() : null;

  // Get an object with the previous document value (for update or delete)
  const oldDocument = change.before.data();

  // If a device no longer gets notifications or does not have a user anymore, remove the push token from the user.
  if (
    
    (oldDocument?.expoPushToken && (!updatedDocument || !updatedDocument.expoPushToken)) ||
    (oldDocument?.latestUserId && (!updatedDocument || !updatedDocument.latestUserId))
  ) {
    if (oldDocument.latestUserId && typeof oldDocument.latestUserId === "string") {
      // Get the user's document form /users/{oldDocument.latestUserId}
      const userDocument = firestore.doc(`users/${oldDocument?.latestUserId}`);
      // Remove the expoPushToken from the user's registeredPushTokens array
      await userDocument.update({
        registeredPushTokens: FieldValue.arrayRemove(oldDocument.expoPushToken),
      });
    }
  }

  // If a device starts getting notifications or has a user but didn't before, remove the push token from the user.
  if (
    updatedDocument &&
    ((!oldDocument?.expoPushToken && updatedDocument.expoPushToken) ||
      (!oldDocument?.latestUserId && updatedDocument.latestUserId))
  ) {
    if (updatedDocument.latestUserId && typeof updatedDocument.latestUserId === "string") {
      // Get the user's document form /users/{oldDocument.latestUserId}
      const userDocument = firestore.doc(`users/${updatedDocument?.latestUserId}`);
      // Remove the expoPushToken from the user's registeredPushTokens array
      await userDocument.update({
        registeredPushTokens: FieldValue.arrayUnion(updatedDocument.expoPushToken),
      });
    }
  }

  // If a device's user changes, remove the token from the old user and add it to the new user.
  if (
    updatedDocument &&
    updatedDocument.expoPushToken &&
    typeof oldDocument?.latestUserId === "string" &&
    typeof updatedDocument.latestUserId === "string" &&
    oldDocument.latestUserId !== updatedDocument.latestUserId
  ) {
    // Get the user's document form /users/{oldDocument.latestUserId}
    const oldUserDocument = firestore.doc(`users/${oldDocument.latestUserId}`);
    // Remove the expoPushToken from the user's registeredPushTokens array
    await oldUserDocument.update({
      registeredPushTokens: FieldValue.arrayRemove(oldDocument.expoPushToken),
    });
    // Get the user's document form /users/{oldDocument.latestUserId}
    const newUserDocument = firestore.doc(`users/${updatedDocument.latestUserId}`);
    // Remove the expoPushToken from the user's registeredPushTokens array
    await newUserDocument.update({
      registeredPushTokens: FieldValue.arrayUnion(updatedDocument.expoPushToken),
    });
  }
});
