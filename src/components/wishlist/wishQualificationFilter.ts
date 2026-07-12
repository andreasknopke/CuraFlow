interface WorkplaceQualification {
    is_mandatory: boolean;
    is_excluded: boolean;
    qualification_id: string;
}

interface Workplace {
    id: string;
}

export function isDoctorQualifiedForWishWorkplace(
    doctorQualificationIds: string[],
    workplaceQualifications: WorkplaceQualification[] = [],
): boolean {
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

export function filterQualifiedWishServiceTypes(
    workplaces: Workplace[],
    doctorQualificationIds: string[],
    workplaceQualificationsByWorkplaceId: Record<string, WorkplaceQualification[]>,
): Workplace[] {
    return (workplaces || []).filter((workplace) => isDoctorQualifiedForWishWorkplace(
        doctorQualificationIds,
        workplaceQualificationsByWorkplaceId?.[workplace.id] || [],
    ));
}
