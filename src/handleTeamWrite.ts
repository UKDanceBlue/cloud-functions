import { FieldPath, FieldValue, getFirestore } from "firebase-admin/firestore";
import { firestore as functionsFirestore, logger } from "firebase-functions";

export default functionsFirestore.document("/spirit/teams/documents/{teamId}").onWrite(async (change, context) => {
  // Mirror the fields "name", "teamClass", and totalPoints from /spirit/teams/documents/{teamId} to /spirit/teams.basicInfo.{teamId}
  const teamId = context.params.teamId as unknown;
  if (typeof teamId !== "string") {
    return;
  }

  if (!change.after.exists) {
    return getFirestore().collection("spirit").doc("teams").update({
      [`basicInfo.${teamId}`]: FieldValue.delete(),
    }).catch((error) => {
      logger.error(error);
    });
  } else {

    const { name, teamClass, totalPoints } = change.after.data() ?? {};
    if (typeof name !== "string" || typeof teamClass !== "string" || typeof totalPoints !== "number") {
      return;
    } else {
      const batch = getFirestore().batch();
      const basicInfoDoc = getFirestore().doc("/spirit/teams");
      batch.update(basicInfoDoc, new FieldPath("basicInfo", teamId), {
        name,
        teamClass,
        totalPoints,
      });
      await batch.commit();
    }
  }
});
