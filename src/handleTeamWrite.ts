import { FieldPath, FieldValue, getFirestore } from "firebase-admin/firestore";
import { firestore as functionsFirestore, logger } from "firebase-functions";

export default functionsFirestore.document("/spirit/teams/documents/{teamId}").onWrite(async (change, context) => {
  // Mirror the fields "name", "teamClass", and totalPoints from /spirit/teams/documents/{teamId} to /spirit/teams.basicInfo.{teamId}
  const teamId = context.params.teamId as unknown;
  if (typeof teamId !== "string") {
    return;
  }

  const batch = getFirestore().batch();

  if (!change.before.exists) {
    // New team
    batch.update(change.after.ref, {
      totalPoints: (change.after.get("totalPoints") as number | undefined) ?? 0,
      teamClass: (change.after.get("teamClass") as string | undefined) ?? "public",
    });
  }

  if (!change.after.exists) {
    return getFirestore().collection("spirit").doc("teams").update({
      [`basicInfo.${teamId}`]: FieldValue.delete(),
    }).catch((error) => {
      logger.error(error);
    });
  } else {
    const { name, teamClass, totalPoints } = change.after.data() ?? {};
    const docData: { name?: string, teamClass?: string, totalPoints?: number } = {};
    if (typeof name === "string") {
      docData.name = name;
    }
    if (typeof teamClass === "string") {
      docData.teamClass = teamClass;
    }
    if (typeof totalPoints === "number") {
      docData.totalPoints = totalPoints;
    }
    const basicInfoDoc = getFirestore().doc("/spirit/teams");
    batch.update(basicInfoDoc, new FieldPath("basicInfo", teamId), docData);
  }

  await batch.commit();
});
