// Listen for messages from popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'PROCESS_LEADS') {
        const leads = request.leads;
        const globalIndustry = request.globalIndustry;

        sendResponse({ status: 'STARTED' });

        processLeads(leads, globalIndustry);
        return true; // Keep channel open
    }
});

async function processLeads(leads, globalIndustry) {
    let successCount = 0;
    let failCount = 0;

    for (let i = 0; i < leads.length; i++) {
        const lead = leads[i];
        reportLog(`Processing (${i + 1}/${leads.length}): ${lead.email}`, 'info');

        try {
            await fillAndSubmit(lead, globalIndustry);
            successCount++;
            reportLog(`Success: ${lead.email}`, 'success');
        } catch (err) {
            failCount++;
            reportLog(`Failed: ${lead.email} - ${err.message}`, 'error');
        }

        // Small delay between requests to be safe
        await new Promise(r => setTimeout(r, 1000));
    }

    reportLog(`Complete. Success: ${successCount}, Failed: ${failCount}`, 'info', true);
}

async function fillAndSubmit(lead, globalIndustry) {
    // We will use the page's existing form and AJAX logic if possible, 
    // OR construct a FormData object and post it manually using the same endpoint the form uses.

    // Looking at the provided HTML file:
    // Form ID: "add_form"
    // Action URL for AJAX: base_url + "/bde/insert_industry"  (Wait, that sounds like industry insetion?)
    // Let's check the script again in the HTML file provided by user.
    // Line 486: url: base_url + "/bde/insert_industry"
    // Wait, the form header says "Add Lead" (Line 226). 
    // But the AJAX endpoint is `insert_industry`? That's weird naming by the developer of the site, but we must respect it.
    // Line 489: url: base_url + "/bde/insert_industry"

    // Inputs:
    // industry (select)
    // location (select)
    // company (text)
    // email (text)
    // mobile (text)
    // contact_person (text)
    // dealing (text)
    // gst (text)
    // requirments (textarea)
    // comment (textarea)

    // We can try to reuse the Global `base_url` variable from the page context if we inject code, 
    // but content scripts run in an isolated world.
    // However, the HTML says: var base_url = 'https://employer.tigihr.com/admin';

    const BASE_URL = 'https://employer.tigihr.com/admin';
    const SUBMIT_URL = BASE_URL + '/bde/insert_industry';

    // 1. Get Industry and Location values
    // We need valid IDs for the select boxes. If the user didn't provide one, we use whatever is currently selected or default.
    // The select elements use Select2, so the actual <select> element might be hidden, but we should set the value on the <select> element.

    let industryVal = globalIndustry;
    if (!industryVal) {
        const industrySelect = document.querySelector('#industry');
        if (industrySelect && industrySelect.value && industrySelect.value !== 'null') {
            industryVal = industrySelect.value;
        } else {
            // Try to find the first option? Or fail?
            // If the user hasn't selected anything on the page, this might fail validation.
            // Let's assume the user selects it on the page before running.
            if (industrySelect) industryVal = industrySelect.value;
        }
    }

    let locationVal = '';
    const locationSelect = document.querySelector('#location');
    if (locationSelect) {
        locationVal = locationSelect.value;
    }

    if (!industryVal || industryVal === 'null' || !locationVal || locationVal === 'null') {
        // Should we try to set defaults? Or throw?
        // Let's throw to warn user.
        // throw new Error("Please select Industry and Location on the page first.");
    }

    // 2. Prepare Form Data like the page does
    // The page uses FormData.
    const formData = new FormData();

    // Basic fields
    formData.append('industry', industryVal || ''); // The page sends array? script says: other_industry = $("#industry").val() -> which is passed to formData
    formData.append('location', locationVal || ''); // same

    formData.append('company', lead.company || '');
    formData.append('email', lead.email || '');
    formData.append('mobile', lead.mobile || '');
    formData.append('contact_person', lead.contact_person || '');
    formData.append('dealing', ''); // Default empty
    formData.append('gst', ''); // Default empty
    formData.append('requirments', lead.requirements || ''); // Now populating requirements
    formData.append('comment', lead.comment || '');

    // The page also sends file inputs: image_name[], image_name_2[]
    // We can append empty strings or nothing? Content-Type multipart/form-data handles it.

    // 3. Perform AJAX request
    // We fetch from the content script context.
    // Note: The page uses Cookies for Auth. fetch() credentials: 'include' is important.

    const response = await fetch(SUBMIT_URL, {
        method: 'POST',
        body: formData, // fetch sets content-type header automatically for FormData
        credentials: 'include' // Send cookies
    });

    const responseText = await response.text();

    // logic from page: if (returnData === "TRUE")
    if (responseText.includes("TRUE") || response.ok) { // The server returns "TRUE" string apparently.
        return true;
    } else {
        throw new Error("Server response: " + responseText);
    }
}

function reportLog(text, type, done = false) {
    chrome.runtime.sendMessage({
        action: 'LOG_UPDATE',
        text: text,
        type: type,
        done: done
    });
}
