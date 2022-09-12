import { Timestamp, getFirestore } from "firebase-admin/firestore";
import { firestore as functionsFirestore } from "firebase-functions";

export default functionsFirestore.document("/spirit/opportunities/documents/{opportunityId}").onWrite(async (change, context) => {
  // Mirror the fields "date" and "name" from /spirit/opportunities/documents/{opportunityId} to /spirit/opportunities.basicInfo.{opportunityId}
  const opportunityId = context.params.opportunityId as unknown;
  if (typeof opportunityId !== "string") {
    return;
  }

  const { name, date } = change.after.data() ?? {};
  if (typeof name !== "string" || !(date instanceof Timestamp)) {
    return;
  }

  const batch = getFirestore().batch();
  const basicInfoDoc = getFirestore().doc("/spirit/opportunities");
  batch.set(basicInfoDoc, {[opportunityId]: { name, date }}, { merge: true });
  await batch.commit();
});
