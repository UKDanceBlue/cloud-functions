import { getAuth } from "firebase-admin/auth";
import { HttpsError } from "firebase-functions/v1/https";
import * as functions from "firebase-functions";
import directoryLookup from "./common/directoryLookup.js";

export default functions.https.onCall(async (data, context) => {
  // TODO validate context.app.token (Firebase App Check)

  if (!context?.auth?.uid) {
    throw new HttpsError("permission-denied", "The function must be called while authenticated.");
  }

  const firebaseAuth = getAuth();

  const {
    uid,
    token: { email },
  } = context.auth;

  if (!email) {
    throw new HttpsError(
      "permission-denied",
      "The function must be called while authenticated with a valid email."
    );
  }

  const directoryEntry = await directoryLookup(
    {
      lastAssociatedUid: uid,
      upn: email,
      email,
    },
    false
  );

  if (Array.isArray(directoryEntry)) {
    throw new HttpsError(
      "cancelled",
      "Uhh, that's not supposed to happen. The function 'directoryLookup' returned an array when told not too."
    );
  }

  const customClaims: { [key: string]: string | number | boolean } = {};

  if (directoryEntry) {
    const { spiritTeamId, dbRole, committeeRank, committee, marathonAccess, spiritCaptain } =
      directoryEntry;

    if (dbRole) {
      customClaims.dbRole = dbRole;
    } else {
      customClaims.dbRole = "public";
    }

    if (committeeRank) {
      customClaims.committeeRank = committeeRank;
    }
    if (committee) {
      customClaims.committee = committee;
    }

    customClaims.marathonAccess = !!marathonAccess || dbRole === "committee";

    if (dbRole === "team-member") {
      customClaims.spiritCaptain = !!spiritCaptain;
      if (spiritTeamId) {
        customClaims.spiritTeamId = spiritTeamId;
      }
    }
  }

  functions.logger.log(`Attempting to add custom claims to ${uid}.`, customClaims);
  await firebaseAuth.setCustomUserClaims(uid, customClaims);
});
