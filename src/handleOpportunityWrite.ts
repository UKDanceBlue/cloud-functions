import { Timestamp, getFirestore } from "firebase-admin/firestore";
import { firestore as functionsFirestore, logger } from "firebase-functions";

export default functionsFirestore.document("/spirit/opportunities/documents/{opportunityId}").onWrite(async (change, context) => {
  // Mirror the fields "date" and "name" from /spirit/opportunities/documents/{opportunityId} to /spirit/opportunities.basicInfo.{opportunityId}
  const opportunityId = context.params.opportunityId as unknown;
  if (typeof opportunityId !== "string") {
    logger.log("opportunityId is not a string, aborting");
    return;
  }

  const { name, date } = change.after.data() ?? {};
  if (typeof name !== "string" || !(date instanceof Timestamp)) {
    logger.log("name or date is not a string or a Timestamp, aborting");
    return;
  }

  const batch = getFirestore().batch();
  const basicInfoDoc = getFirestore().doc("/spirit/opportunities");
  batch.set(basicInfoDoc, {[opportunityId]: { name, date }}, { merge: true });
  logger.debug(`Added "Set /spirit/opportunities.${opportunityId}" to batch`);

  try {
    logger.debug("Committing batch");
    await batch.commit();
    logger.debug("Batch committed");
  } catch (error) {
    logger.error(error);
  } finally {
    logger.debug("Done");
  }
});
