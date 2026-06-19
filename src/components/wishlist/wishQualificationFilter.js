export function isDoctorQualifiedForWishWorkplace(doctorQualificationIds, workplaceQualifications = []) {
    const doctorQualSet = new Set(doctorQualificationIds || []);

    const hasExcludedQualification = workplaceQualifications.some(
        (qualification) => !qualification.is_mandatory && qualification.is_excluded && doctorQualSet.has(qualification.qualification_id),
    );

    if (hasExcludedQualification) {
        return false;
    }

    const requiredQualifications = workplaceQualifications.filter(
        (qualification) => qualification.is_mandatory && !qualification.is_excluded,
    );

    return requiredQualifications.every((qualification) => doctorQualSet.has(qualification.qualification_id));
}

export function filterQualifiedWishServiceTypes(workplaces, doctorQualificationIds, workplaceQualificationsByWorkplaceId) {
    return (workplaces || []).filter((workplace) => isDoctorQualifiedForWishWorkplace(
        doctorQualificationIds,
        workplaceQualificationsByWorkplaceId?.[workplace.id] || [],
    ));
}