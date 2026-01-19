import { createClientFromRequest } from 'npm:@base44/sdk@^0.8.3';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        
        // Parse body
        let body = {};
        try {
            body = await req.json();
        } catch (e) {
            // ignore
        }

        const { year, stateCode } = body;

        if (!year || !stateCode) {
            return Response.json({ error: "Missing year or stateCode" }, { status: 400 });
        }

        // Prepare OpenHolidays API params
        // Map state code (e.g. "MV" -> "DE-MV")
        const isoStateCode = stateCode.includes('-') ? stateCode : `DE-${stateCode}`;
        const countryCode = 'DE';
        
        const startYear = parseInt(year) - 1;
        const endYear = parseInt(year) + 1;
        const validFrom = `${startYear}-01-01`;
        const validTo = `${endYear}-12-31`;

        // Fetch in parallel
        const [schoolRes, publicRes] = await Promise.all([
            fetch(`https://openholidaysapi.org/SchoolHolidays?countryIsoCode=${countryCode}&subdivisionCode=${isoStateCode}&validFrom=${validFrom}&validTo=${validTo}&languageIsoCode=DE`),
            fetch(`https://openholidaysapi.org/PublicHolidays?countryIsoCode=${countryCode}&subdivisionCode=${isoStateCode}&validFrom=${validFrom}&validTo=${validTo}&languageIsoCode=DE`)
        ]);

        const schoolData = [];
        const publicData = [];

        if (schoolRes.ok) {
            const data = await schoolRes.json();
            // Map to format: { start: "YYYY-MM-DD", end: "YYYY-MM-DD", name: "Name" }
            data.forEach(item => {
                schoolData.push({
                    start: item.startDate,
                    end: item.endDate,
                    name: item.name && item.name.length > 0 ? item.name[0].text : "Ferien"
                });
            });
        }

        if (publicRes.ok) {
            const data = await publicRes.json();
            // Map to format: { date: "YYYY-MM-DD", name: "Name" }
            data.forEach(item => {
                publicData.push({
                    date: item.startDate,
                    name: item.name && item.name.length > 0 ? item.name[0].text : "Feiertag"
                });
            });
        }

        return Response.json({ school: schoolData, public: publicData });

    } catch (error) {
        return Response.json({ error: error.message }, { status: 500 });
    }
});