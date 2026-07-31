export async function deleteEmployeeDependentRecords(dbPool, employeeId) {
  const [sharedShiftResult] = await dbPool.execute(
    'DELETE FROM shared_shift_entry WHERE employee_id = ?',
    [employeeId]
  );
  const [assignmentResult] = await dbPool.execute(
    'DELETE FROM EmployeeTenantAssignment WHERE employee_id = ?',
    [employeeId]
  );
  const [timeAccountResult] = await dbPool.execute(
    'DELETE FROM TimeAccount WHERE employee_id = ?',
    [employeeId]
  );

  return {
    deletedSharedShiftEntries: Number(sharedShiftResult?.affectedRows || 0),
    deletedAssignments: Number(assignmentResult?.affectedRows || 0),
    deletedTimeAccounts: Number(timeAccountResult?.affectedRows || 0),
  };
}
