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
    const BASE_URL = 'https://employer.tigihr.com/admin';
    const SUBMIT_URL = BASE_URL + '/bde/insert_industry';

    // 1. Get Industry and Location values
    let industryVal = globalIndustry;
    if (!industryVal) {
        const industrySelect = document.querySelector('#industry');
        if (industrySelect && industrySelect.value && industrySelect.value !== 'null') {
            industryVal = industrySelect.value;
        }
    }

    let locationVal = '';
    const locationSelect = document.querySelector('#location');
    if (locationSelect) {
        locationVal = locationSelect.value;
    }

    // 2. Prepare Form Data
    // we try to use the existing form on the page to capture all fields (hidden or otherwise)
    const existingForm = document.getElementById('add_form');
    let formData;

    if (existingForm) {
        formData = new FormData(existingForm);
        // Overwrite/Set specific values we are automating
        // Note: .set() updates value if key exists, or adds it.
        if (industryVal) formData.set('industry', industryVal);
        if (locationVal) formData.set('location', locationVal);

        formData.set('company', lead.company || '');
        formData.set('email', lead.email || '');
        formData.set('mobile', lead.mobile || '');
        formData.set('contact_person', lead.contact_person || '');

        // Ensure these act as defaults if not overwritten, but usually we just want empty if not provided
        formData.set('dealing', '');
        formData.set('gst', '');

        // Critical fields
        formData.set('requirments', lead.requirements || ''); // Typo in 'requirments' matches page source
        formData.set('comment', lead.comment || '');

    } else {
        // Fallback if form not found in DOM (rare if content script runs on correct page)
        formData = new FormData();
        formData.append('industry', industryVal || '');
        formData.append('location', locationVal || '');
        formData.append('company', lead.company || '');
        formData.append('email', lead.email || '');
        formData.append('mobile', lead.mobile || '');
        formData.append('contact_person', lead.contact_person || '');
        formData.append('dealing', '');
        formData.append('gst', '');
        formData.append('requirments', lead.requirements || '');
        formData.append('comment', lead.comment || '');
    }

    // 3. Perform AJAX request
    const response = await fetch(SUBMIT_URL, {
        method: 'POST',
        body: formData,
        credentials: 'include' // Send cookies
    });

    const responseText = await response.text();

    if (responseText.includes("TRUE") || response.ok) {
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
