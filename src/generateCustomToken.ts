import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import * as functions from "firebase-functions";
import { decode } from "jsonwebtoken";
import fetch from "node-fetch";
import { v4 } from "uuid";

import directoryLookup from "./common/directoryLookup.js"

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
    throw new Error("Nonce mismatch");
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

  const userDocument = {
    firstName,
    lastName,
    linkblue: upn.split("@")[0]
  } as Record<string, string>;

  const profile = await (await fetch("https://graph.microsoft.com/v1.0/me/", { headers: { "Authorization": `Bearer ${accessToken}` } })).json() as Record<string, unknown>;

  const profileEmail = profile.mail;

  const uid = (profile.id as string) ?? v4();

  if (profileEmail != null && typeof profileEmail === "string") {
    userDocument.email = profileEmail;
  }

  const directoryEntry = await directoryLookup({ upn, firstName, lastName, email: (profileEmail as string) ?? undefined });

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

  const db = getFirestore();
  await db.collection("users").doc(uid).set({ ...userDocument, attributes: { ...customClaims } }, { merge: true });

  const auth = getAuth();
  const customToken = await auth.createCustomToken(uid, customClaims);

  return customToken;
});
