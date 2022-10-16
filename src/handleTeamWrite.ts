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
    const { name, teamClass, totalPoints, members, captains } = change.after.data() ?? {};
    const { members: existingMembers } = change.before.data() ?? {};

    const basicInfo: { name?: string, teamClass?: string, totalPoints?: number } = {};

    if (typeof name === "string") {
      basicInfo.name = name;
    }
    if (typeof teamClass === "string") {
      basicInfo.teamClass = teamClass;
    }
    if (typeof totalPoints === "number") {
      basicInfo.totalPoints = totalPoints;
    }
    const rootTeamDoc = getFirestore().doc("/spirit/teams");
    batch.update(rootTeamDoc, new FieldPath("basicInfo", teamId), basicInfo);

    const checkCaptains = Array.isArray(captains);
    if (Array.isArray(members)) {
      for (const member of members) {
        if (typeof member === "string") {
          batch.update(rootTeamDoc, new FieldPath("membershipInfo", member), {
            teamId,
            isCaptain: checkCaptains && captains.includes(member),
          });
        }
      }
      if (Array.isArray(existingMembers)) {
        for (const member of existingMembers) {
          if (!members.includes(member) && typeof member === "string") {
            batch.update(rootTeamDoc, new FieldPath("membershipInfo", member), FieldValue.delete());
          }
        }
      }
    }
  }

  await batch.commit();
});
