import { getFirestore } from "firebase-admin/firestore";

export default async (data, context) => {
  const { teamId, newTeamName, newSpreadsheetId, newNetworkForGoodId } = data;

  const updateTeamConfig = (await getFirestore().doc("configs/update-team").get()).data();

  const email = context.auth?.token?.email;
  const emails = updateTeamConfig.allowedEmails;
  if (!emails.includes(email)) {
    return {
      status: "error",
      error: {
        code: "not-authorized",
        message: "Your account is not authorized to send push notifications. No action was taken.",
      },
    };
  }

  const docData = {};
  if (newTeamName) {
    docData.name = newTeamName.toString();
  }
  if (newSpreadsheetId) {
    docData.spiritSpreadsheetId = newSpreadsheetId.toString();
  }
  if (newNetworkForGoodId || newNetworkForGoodId === 0) {
    docData.networkForGoodId = newNetworkForGoodId.toString();
  }

  const documentReference = teamId
    ? getFirestore().collection("teams").doc(teamId)
    : getFirestore().collection("teams").doc();

  return await documentReference
    .set(docData, { merge: true })
    .then(
      () => {
        return {
          status: "success",
        };
      },
      (reason) => {
        return {
          status: "error",
          error: {
            code: "write-failed",
            reason: reason,
          },
        };
      }
    )
    .catch((reason) => {
      return {
        status: "error",
        error: {
          code: "write-failed",
          reason: reason,
        },
      };
    });
};
