export interface FirestoreTeamInfo {
  name: string;
  members: string[];
  memberAccounts: Record<string, string | null>;
  fundraisingTotal?: number;
  totalPoints?: number;
  networkForGoodId?: string;
}

export function isFirestoreTeamInfo(
  data: unknown
): data is FirestoreTeamInfo {
  if (data == null) {
    return false;
  }

  if (typeof (data as FirestoreTeamInfo).name !== "string") {
    return false;
  }

  if (!Array.isArray((data as FirestoreTeamInfo).members) || (data as FirestoreTeamInfo).members.some((m: unknown) => typeof m !== "string")) {
    return false;
  }

  if (typeof (data as FirestoreTeamInfo).memberAccounts !== "object" || (data as FirestoreTeamInfo).memberAccounts == null) {
    return false;
  }

  if ((data as FirestoreTeamInfo).fundraisingTotal != null && typeof (data as FirestoreTeamInfo).fundraisingTotal !== "number") {
    return false;
  }

  if ((data as FirestoreTeamInfo).totalPoints != null && typeof (data as FirestoreTeamInfo).totalPoints !== "number") {
    return false;
  }

  if ((data as FirestoreTeamInfo).networkForGoodId != null && typeof (data as FirestoreTeamInfo).networkForGoodId !== "string") {
    return false;
  }

  return true;
}
