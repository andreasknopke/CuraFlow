// This hook is now superseded by inline useQuery in Training.jsx.
// It remains as a placeholder for potential reuse.
export function useTrainingRotations(startYear, endYear) {
  // Implementation can be moved here if needed.
  return useQuery({
    queryKey: ['trainingRotations', startYear, endYear],
    queryFn: () => db.TrainingRotation.filter({ ... }),
  });
}
