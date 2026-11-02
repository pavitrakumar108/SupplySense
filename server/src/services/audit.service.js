export async function writeAudit(db, {
  actorId = null,
  action,
  resourceType,
  resourceId = null,
  outcome = 'SUCCESS',
  correlationId = null,
  metadata = {},
}) {
  try {
    await db.auditLog.create({
      data: {
        actorId,
        action,
        resourceType,
        resourceId,
        outcome,
        correlationId,
        metadata,
      },
    });
  } catch (error) {
    // Audit failures must not turn a completed business operation into a false failure.
    console.error('audit write failed', error);
  }
}
