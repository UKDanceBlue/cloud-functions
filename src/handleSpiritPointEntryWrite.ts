import { FieldPath, FieldValue, getFirestore, } from "firebase-admin/firestore";
import { firestore as functionsFirestore, logger } from "firebase-functions";

import { isSpiritPointEntry } from "./types/FirestoreSpiritPointEntry.js";

export default functionsFirestore.document("/spirit/teams/documents/{teamId}/pointEntries/{entryId}").onWrite(async (change, context) => {
  // Get firestore
  const firestore = getFirestore();
  const writeBatch = firestore.batch();

  const teamId = context.params.teamId as string;

  logger.debug(`Extracted teamId: ${teamId} from context.params.teamId`);

  if (change.before.exists) {
    logger.debug(`Detected delete event for teamId: ${teamId}`);

    const entry = change.before.data();

    // Verify the document's structure
    if (!isSpiritPointEntry(entry)) {
      logger.log("Entry was not a valid SpiritPointEntry, aborting");
      if (change.after.exists) {
        return change.after.ref.delete();
      } else {
        return;
      }
    }

    // Delete /spirit/opportunities/documents/{opportunityId}/pointEntries/{entryId}
    const opportunityEntryDocument = firestore.doc(`/spirit/opportunities/documents/${entry.opportunityId}/pointEntries/${change.before.id}`);
    writeBatch.delete(opportunityEntryDocument);
    logger.debug(`Added "Delete opportunityEntryDocument: ${opportunityEntryDocument.path}" to batch`);

    // Decrement /spirit/teams/documents/{teamId}.totalPoints and /spirit/teams/documents/{teamId}.individualTotals.{linkblue ?? '%TEAM%'}
    const teamInfoDocument = firestore.doc(`/spirit/teams/documents/${teamId}`);
    writeBatch.update(teamInfoDocument, {
      totalPoints: FieldValue.increment(-entry.points),
    });
    logger.debug(`Added "Decrement /spirit/teams/documents/${teamId}.totalPoints" to batch`);
    writeBatch.update(teamInfoDocument, {
      [`individualTotals.${entry.linkblue ?? "%TEAM%"}`]: FieldValue.increment(-entry.points),
    });
    logger.debug(`Added "Decrement /spirit/teams/documents/${teamId}.individualTotals.${entry.linkblue ?? "%TEAM%"}" to batch`);

    // Decrement /spirit/teams.basicInfo.{teamId}.totalPoints
    const rootTeamsDoc = firestore.doc("/spirit/teams");
    writeBatch.update(rootTeamsDoc, new FieldPath("basicInfo", teamId, "totalPoints"), FieldValue.increment(-entry.points));
    logger.debug(`Added "Decrement /spirit/teams.points.${teamId}" to batch`);

    // Decrement /spirit/opportunities/documents/{opportunityId}.totalPoints
    const opportunityInfoDocument = firestore.doc(`/spirit/opportunities/documents/${entry.opportunityId}`);
    writeBatch.update(opportunityInfoDocument, {
      totalPoints: FieldValue.increment(-entry.points),
    });
    logger.debug(`Added "Decrement /spirit/opportunities/documents/${entry.opportunityId}.totalPoints" to batch`);

    // Decrement /spirit/info.totalPoints
    const rootInfoDoc = firestore.doc("/spirit/info");
    writeBatch.update(rootInfoDoc, {
      totalPoints: FieldValue.increment(-entry.points),
    });
    logger.debug("Added \"Decrement /spirit/info.totalPoints\" to batch");
  }

  if (change.after.exists) {
    logger.debug(`Detected create event for teamId: ${teamId}`);

    const entry = change.after.data();

    // Verify the document's structure
    if (!isSpiritPointEntry(entry)) {
      logger.log("Entry is not a valid SpiritPointEntry, aborting");
      return change.after.ref.delete();
    }

    // Make a copy to /spirit/opportunities/documents/{opportunityId}/pointEntries/{entryId}
    const opportunityEntryDocument = firestore.doc(`/spirit/opportunities/documents/${entry.opportunityId}/pointEntries/${change.after.id}`);
    writeBatch.set(opportunityEntryDocument, entry);
    logger.debug(`Added "Create opportunityEntryDocument: ${opportunityEntryDocument.path}" to batch`);

    // Increment /spirit/teams/documents/{teamId}.totalPoints and /spirit/teams/documents/{teamId}.individualTotals.{linkblue ?? '%TEAM%'}
    const teamInfoDocument = firestore.doc(`/spirit/teams/documents/${teamId}/`);
    writeBatch.update(teamInfoDocument, {
      totalPoints: FieldValue.increment(entry.points),
    });
    logger.debug(`Added "Increment /spirit/teams/documents/${teamId}.totalPoints" to batch`);
    writeBatch.update(teamInfoDocument, {
      [`individualTotals.${entry.linkblue ?? "%TEAM%"}`]: FieldValue.increment(entry.points),
    });
    logger.debug(`Added "Increment /spirit/teams/documents/${teamId}.individualTotals.${entry.linkblue ?? "%TEAM%"}" to batch`);

    // Increment /spirit/teams.basicInfo.{teamId}.totalPoints
    const rootTeamsDoc = firestore.doc("/spirit/teams");
    writeBatch.update(rootTeamsDoc, new FieldPath("basicInfo", teamId, "totalPoints"), FieldValue.increment(entry.points));
    logger.debug(`Added "Increment /spirit/teams.points.${teamId}" to batch`);

    // Increment /spirit/opportunities/documents/{opportunityId}.totalPoints
    const opportunityInfoDocument = firestore.doc(`/spirit/opportunities/documents/${entry.opportunityId}`);
    writeBatch.update(opportunityInfoDocument, {
      totalPoints: FieldValue.increment(entry.points),
    });
    logger.debug(`Added "Increment /spirit/opportunities/documents/${entry.opportunityId}.totalPoints" to batch`);

    // Increment /spirit/info.totalPoints
    const rootInfoDoc = firestore.doc("/spirit/info");
    writeBatch.update(rootInfoDoc, {
      totalPoints: FieldValue.increment(entry.points),
    });
    logger.debug("Added \"Increment /spirit/info.totalPoints\" to batch");

    try {
      logger.debug("Committing write batch");
      await writeBatch.commit();
      logger.debug("Write batch committed");
    } catch (error) {
      logger.error(error);
    }

    if (entry.linkblue == null) {
      logger.debug("Setting linkblue of entry to '%TEAM%'")

      return change.after.ref.set({
        linkblue: entry.linkblue ?? "%TEAM%",
      }, { merge: true });
    }
  } else {
    try {
      logger.debug("Committing write batch");
      await writeBatch.commit();
      logger.debug("Write batch committed");
    } catch (error) {
      logger.error(error);
    }
  }

});
