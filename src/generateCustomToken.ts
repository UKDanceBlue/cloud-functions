import { UpdateRequest, getAuth } from "firebase-admin/auth";
import { DocumentReference, FieldPath, getFirestore } from "firebase-admin/firestore";
import * as functions from "firebase-functions";
import { decode } from "jsonwebtoken";
import fetch from "node-fetch";
import { v4 } from "uuid";

import directoryLookup from "./common/directoryLookup.js"

interface FirestoreUser {
  attributes: Record<string, string>;
  email: string;
  firstName: string;
  lastName: string;
  phoneNumber?: string;
  linkblue?: string | null;
  team?: DocumentReference | null;
}

export default functions.https.onCall(async (data: { accessToken: string, nonce?: string }) => {
  if (data == null) {
    throw new Error("No data provided");
  }

  const { accessToken, nonce } = data;
  if (accessToken == null) {
    throw new Error("No code provided");
  }

  const customClaims: Record<string, unknown> = {};

  const decodedAccessToken = decode(accessToken, { complete: true });
  if (decodedAccessToken?.header == null) {
    throw new Error("Invalid access token");
  }
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore nonce is a non-standard entry that Azure adds
  if (nonce != null && decodedAccessToken.header.nonce != nonce) {
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore nonce is a non-standard entry that Azure adds
    throw new Error(`Nonce mismatch (expected ${nonce}, got ${decodedAccessToken.header.nonce as string})`);
  }

  if (decodedAccessToken?.payload == null) {
    throw new Error("Invalid access token");
  }
  if (typeof decodedAccessToken.payload === "string") {
    throw new Error("Parsing the access token produced an payload");
  }

  const {
    upn,
    given_name: firstName,
    family_name: lastName
  }: Record<string, string> = decodedAccessToken.payload;

  const userDocument: FirestoreUser = {
    firstName,
    lastName,
    linkblue: upn.split("@")[0],
    email: upn,
    attributes: {},
  };

  const profile = await (await fetch("https://graph.microsoft.com/v1.0/me/", { headers: { "Authorization": `Bearer ${accessToken}` } })).json() as Record<string, unknown>;

  const uid = (profile.id as string) ?? v4();

  const profileEmail = profile.mail;

  if (profileEmail != null && typeof profileEmail === "string") {
    userDocument.email = profileEmail;
  }

  let profilePhoneNumber = profile.mobilePhone as string;

  if (profilePhoneNumber != null && typeof profilePhoneNumber === "string") {
    userDocument.phoneNumber = profilePhoneNumber;
  } else {
    const businessPhones = profile.businessPhones;
    if (businessPhones != null && Array.isArray(businessPhones) && businessPhones.length >= 1) {
      if (typeof businessPhones[0] === "string") {
        profilePhoneNumber = businessPhones[0];
        userDocument.phoneNumber = profilePhoneNumber;
      }
    }
  }

  // Remove anything except for pluses and numbers from the phone number
  if (userDocument.phoneNumber != null) {
    userDocument.phoneNumber = userDocument.phoneNumber.replace(/[^\\+0-9]/g, "");

    if (!(new RegExp("^\\+[1-9]\\d{1,14}$")).test(userDocument.phoneNumber)) {
      delete userDocument.phoneNumber;
    }
  }

  const directoryEntry = await directoryLookup({ upn, firstName, lastName, email: userDocument.email });

  if (directoryEntry != null && !Array.isArray(directoryEntry)) {
    if (directoryEntry.committee != null) {
      customClaims.committee = directoryEntry.committee;
    }
    if (directoryEntry.committeeRank != null) {
      customClaims.committeeRank = directoryEntry.committeeRank;
    }
    if (directoryEntry.dbRole != null) {
      customClaims.dbRole = directoryEntry.dbRole;
    }
    if (directoryEntry.marathonAccess != null) {
      customClaims.marathonAccess = directoryEntry.marathonAccess;
    }
    if (directoryEntry.spiritCaptain != null) {
      customClaims.spiritCaptain = directoryEntry.spiritCaptain;
    }
    if (directoryEntry.spiritTeamId != null) {
      customClaims.spiritTeamId = directoryEntry.spiritTeamId;
    }
  }

  if (uid == null) {
    throw new Error("No sub in the access token");
  }

  const userData: UpdateRequest = {
    displayName: `${firstName} ${lastName}`
  }

  if (userDocument.email != null) {
    userData.email = userDocument.email;
    userData.emailVerified = true;
  }

  if (userDocument.phoneNumber != null) {
    userData.phoneNumber = userDocument.phoneNumber;
  }

  if (typeof userDocument.linkblue === "string") {
    const rootTeamDoc = getFirestore().doc("/spirit/teams");
    const rootTeamDocSnapshot = await rootTeamDoc.get();
    if (rootTeamDocSnapshot.exists) {
      const membershipInfo = rootTeamDocSnapshot.get(new FieldPath("membershipInfo", userDocument.linkblue)) as { teamId?: string, isCaptain?: boolean } | undefined;
      if (membershipInfo != null && typeof membershipInfo.teamId === "string") {
        const teamDoc = getFirestore().doc(`/spirit/teams/documents/${membershipInfo.teamId}`);

        await teamDoc.update(`memberAccounts.${userDocument.linkblue}`, uid);
        await teamDoc.update(`memberNames.${userDocument.linkblue}`, `${firstName} ${lastName}`);

        userDocument.team = teamDoc;
        customClaims.spiritTeamId = membershipInfo.teamId;
        if (membershipInfo.isCaptain === true) {
          customClaims.spiritCaptain = true;
        }
      }
    }
  }

  const auth = getAuth();

  const existingUsersCount = (await auth.getUsers([{ uid }])).users.length;
  if (existingUsersCount === 0) {
    await auth.createUser({ uid, ...userData, multiFactor: undefined });
  } else if (existingUsersCount === 1) {
    await auth.updateUser(uid, userData);
  } else {
    throw new Error("Multiple users with the same uid (this is an invariant violation and should be impossible)");
  }

  const customToken = await auth.createCustomToken(uid, customClaims);

  const db = getFirestore();
  await db.collection("users").doc(uid).set({ ...userDocument, attributes: { ...customClaims } }, { merge: true });

  return customToken;
});
