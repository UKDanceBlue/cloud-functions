import { getFirestore } from "firebase-admin/firestore";
import { firestore as functionsFirestore } from "firebase-functions";

export default functionsFirestore.document("/spirit/teams/documents/{teamId}").onWrite(async (change, context) => {
  // Mirror the fields "name", "teamClass", and totalPoints from /spirit/teams/documents/{teamId} to /spirit/teams.basicInfo.{teamId}
  const teamId = context.params.teamId as unknown;
  if (typeof teamId !== "string") {
    return;
  }

  const { name, teamClass, totalPoints } = change.after.data() ?? {};
  if (typeof name !== "string" || typeof teamClass !== "string" || typeof totalPoints !== "number") {
    return;
  }

  const batch = getFirestore().batch();
  const basicInfoDoc = getFirestore().doc("/spirit/teams");
  batch.set(basicInfoDoc, {[teamId]: { name, teamClass, totalPoints }}, { merge: true });
  await batch.commit();
});
