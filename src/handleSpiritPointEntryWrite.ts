import { FieldPath, FieldValue, getFirestore,  } from "firebase-admin/firestore";
import { firestore as functionsFirestore, logger } from "firebase-functions";

import { isSpiritPointEntry } from "./types/FirestoreSpiritPointEntry.js";

export default functionsFirestore.document("/spirit/teams/documents/{teamId}/pointEntries/{entryId}").onWrite(async (change, context) => {
  // Get firestore
  const firestore = getFirestore();
  const batch = firestore.batch();

  const teamId = context.params.teamId as string;

  logger.debug(`Extracted teamId: ${teamId} from context.params.teamId`);

  if (context.eventType === "google.firestore.document.create") {
    logger.debug(`Detected create event for teamId: ${teamId}`);

    const entry = change.after.data();

    if (entry == null || entry.opportunityId == null) {
      logger.log("Entry or entry.opportunityId is nullish, aborting");
      return;
    }

    // Verify the document's structure
    if (!isSpiritPointEntry(entry)) {
      logger.log("Entry is not a valid SpiritPointEntry, aborting");
      return change.after.ref.delete();
    }

    // Make a copy to /spirit/opportunities/documents/{opportunityId}/pointEntries/{entryId}
    const opportunityEntryDocument = firestore.doc(`/spirit/opportunities/documents/${entry.opportunityId}/pointEntries/${change.after.id}`);
    batch.set(opportunityEntryDocument, entry);
    logger.debug(`Added "Create opportunityEntryDocument: ${opportunityEntryDocument.path}" to batch`);

    // Increment /spirit/teams/documents/{teamId}.totalPoints and /spirit/teams/documents/{teamId}.individualTotals.{linkblue}
    const teamInfoDocument = firestore.doc(`/spirit/teams/documents/${teamId}/info`);
    batch.update(teamInfoDocument, {
      totalPoints: FieldValue.increment(entry.points),
    });
    logger.debug(`Added "Increment /spirit/teams/documents/${teamId}.totalPoints" to batch`);
    batch.update(teamInfoDocument, {
      [`individualTotals.${entry.linkblue}`]: FieldValue.increment(entry.points),
    });
    logger.debug(`Added "Increment /spirit/teams/documents/${teamId}.individualTotals.${entry.linkblue}" to batch`);

    // Increment /spirit/teams.points.{teamId}
    const rootTeamsDoc = firestore.doc("/spirit/teams");
    batch.update(rootTeamsDoc, new FieldPath("points", teamId), FieldValue.increment(entry.points));
    logger.debug(`Added "Increment /spirit/teams.points.${teamId}" to batch`);

    // Increment /spirit/opportunities/documents/{opportunityId}.totalPoints
    const opportunityInfoDocument = firestore.doc(`/spirit/opportunities/documents/${entry.opportunityId}`);
    batch.update(opportunityInfoDocument, {
      totalPoints: FieldValue.increment(entry.points),
    });
    logger.debug(`Added "Increment /spirit/opportunities/documents/${entry.opportunityId}.totalPoints" to batch`);

    // Increment /spirit/info.totalPoints
    const rootInfoDoc = firestore.doc("/spirit/info");
    batch.update(rootInfoDoc, {
      totalPoints: FieldValue.increment(entry.points),
    });
    logger.debug("Added \"Increment /spirit/info.totalPoints\" to batch");
  } else if(context.eventType === "google.firestore.document.delete") {
    logger.debug(`Detected delete event for teamId: ${teamId}`);

    const entry = change.before.data();

    if (entry == null || entry.opportunityId == null) {
      logger.log("Entry or entry.opportunityId was nullish, aborting");
      return;
    }

    // Verify the document's structure
    if (!isSpiritPointEntry(entry)) {
      logger.log("Entry was not a valid SpiritPointEntry, aborting");
      return;
    }

    // Delete /spirit/opportunities/documents/{opportunityId}/pointEntries/{entryId}
    const opportunityEntryDocument = firestore.doc(`/spirit/opportunities/documents/${entry.opportunityId}/pointEntries/${change.before.id}`);
    batch.delete(opportunityEntryDocument);
    logger.debug(`Added "Delete opportunityEntryDocument: ${opportunityEntryDocument.path}" to batch`);

    // Decrement /spirit/teams/documents/{teamId}.totalPoints and /spirit/teams/documents/{teamId}.individualTotals.{linkblue}
    const teamInfoDocument = firestore.doc(`/spirit/teams/documents/${teamId}/info`);
    batch.update(teamInfoDocument, {
      totalPoints: FieldValue.increment(-entry.points),
    });
    logger.debug(`Added "Decrement /spirit/teams/documents/${teamId}.totalPoints" to batch`);
    batch.update(teamInfoDocument, {
      [`individualTotals.${entry.linkblue}`]: FieldValue.increment(-entry.points),
    });
    logger.debug(`Added "Decrement /spirit/teams/documents/${teamId}.individualTotals.${entry.linkblue}" to batch`);

    // Decrement /spirit/teams.points.{teamId}
    const rootTeamsDoc = firestore.doc("/spirit/teams");
    batch.update(rootTeamsDoc, new FieldPath("points", teamId), FieldValue.increment(-entry.points));
    logger.debug(`Added "Decrement /spirit/teams.points.${teamId}" to batch`);

    // Decrement /spirit/opportunities/documents/{opportunityId}.totalPoints
    const opportunityInfoDocument = firestore.doc(`/spirit/opportunities/documents/${entry.opportunityId}`);
    batch.update(opportunityInfoDocument, {
      totalPoints: FieldValue.increment(-entry.points),
    });
    logger.debug(`Added "Decrement /spirit/opportunities/documents/${entry.opportunityId}.totalPoints" to batch`);

    // Decrement /spirit/info.totalPoints
    const rootInfoDoc = firestore.doc("/spirit/info");
    batch.update(rootInfoDoc, {
      totalPoints: FieldValue.increment(-entry.points),
    });
    logger.debug("Added \"Decrement /spirit/info.totalPoints\" to batch");
  }

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
