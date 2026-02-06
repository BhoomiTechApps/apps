let survey = {
    title: "",
    questions: []
};

function addQuestion() {
    let text = document.getElementById("questionText").value;
    let type = document.getElementById("questionType").value;
    let options = document.getElementById("options").value
        .split("\n")
        .map(o => o.trim())
        .filter(o => o !== "");
    let min = document.getElementById("minValue").value;
    let max = document.getElementById("maxValue").value;
    let minDate = document.getElementById("minDate").value;
    let maxDate = document.getElementById("maxDate").value;
    if (type !== "pagebreak" && !text) {
        alert("Please enter a question");
        return;
    }
    let question = {
        text: text,
        type: type,
        options: options,
        required: document.getElementById("isRequired").checked
    };
    document.getElementById("isRequired").checked = false;
    if (type === "number") {
        question.min = min ? Number(min) : null;
        question.max = max ? Number(max) : null;
    }
    if (type === "date") {
        question.minDate = minDate || null;
        question.maxDate = maxDate || null;
    }
    if (type === "gps" || type === "image") {   
    }
    survey.questions.push(question);
    resetFields();
    generatePreview();
}

function resetFields() {
    document.getElementById("questionText").value = "";
    document.getElementById("options").value = "";
    document.getElementById("minValue").value = "";
    document.getElementById("maxValue").value = "";
    document.getElementById("minDate").value = "";
    document.getElementById("maxDate").value = "";
}

function deleteQuestion(index) {
    survey.questions.splice(index, 1);
    generatePreview();
}

function editQuestion(index) {
    let q = survey.questions[index];
    document.getElementById("questionText").value = q.text;
    document.getElementById("questionType").value = q.type;
    document.getElementById("options").value = q.options.join("\n");
    document.getElementById("isRequired").checked = q.required;
    if (q.type === "number") {
        document.getElementById("minValue").value = q.min ?? "";
        document.getElementById("maxValue").value = q.max ?? "";
    }
    if (q.type === "date") {
        document.getElementById("minDate").value = q.minDate ?? "";
        document.getElementById("maxDate").value = q.maxDate ?? "";
    }
    survey.questions.splice(index, 1);
    generatePreview();
}

function generatePreview() {
    survey.title = document.getElementById("surveyTitle").value;
    let twoColumn = document.getElementById("twoColumn").checked;
    let html = `<h2>${survey.title}</h2>`;
    html += `
        <div id="previewEditModeContainer">
            <label>
                <input type="checkbox" id="previewEditMode"> Show Edit/Delete Buttons
            </label>
        </div>
    `;
    html += `<form id="surveyForm" class="${twoColumn ? 'two-column' : 'one-column'}" onsubmit="return submitResponses(event)">`;
    survey.questions.forEach((q, index) => {
        if (q.type === "pagebreak") {
            html += `<div class="pagebreak"></div>`;
            return;
        }
        html += `<div class="question-block">`;
        let requiredMark = q.required ? `<span style="color:red"> *</span>` : "";
            html += `<label>${index + 1}. ${q.text}${requiredMark}</label>`;
        let req = q.required ? "required" : "";
        if (q.type === "text") {
            html += `<input type="text" id="text${index}" ${req}>`;
        }
        if (q.type === "textarea") {
            html += `<textarea id="textarea${index}" ${req}></textarea>`;
        }
        if (q.type === "email") {
            html += `<input type="email" id="email${index}" ${req}>
                     <span class="error" id="error${index}"></span>`;
        }
        if (q.type === "number") {
            let minAttr = q.min !== null ? `min="${q.min}"` : "";
            let maxAttr = q.max !== null ? `max="${q.max}"` : "";
            html += `<input type="number" id="number${index}" ${minAttr} ${maxAttr} ${req}>
                     <span class="error" id="error${index}"></span>`;
            if (q.min || q.max) {
                html += `<small>Range: ${q.min ?? "-âˆž"} to ${q.max ?? "âˆž"}</small>`;
            }
        }
        if (q.type === "date") {
            let minAttr = q.minDate ? `min="${q.minDate}"` : "";
            let maxAttr = q.maxDate ? `max="${q.maxDate}"` : "";
            html += `<input type="date" id="date${index}" ${minAttr} ${maxAttr} ${req}>
                     <span class="error" id="error${index}"></span>`;
            if (q.minDate || q.maxDate) {
                html += `<small>Range: ${q.minDate ?? "Any"} to ${q.maxDate ?? "Any"}</small>`;
            }
        }
        if (q.type === "phone") {
            html += `<input type="text" id="phone${index}" placeholder="+919401065598" ${req}>
                     <span class="error" id="error${index}"></span>`;
        }
        if (q.type === "radio") {
            html += `<div class="radio-group">`;
              q.options.forEach(opt => {
            html += `<label><input type="radio" name="q${index}" ${req}> ${opt}</label>`;
          });
          html += `</div>`;
        }
        if (q.type === "checkbox") {
            html += `<div class="checkbox-group">`;
              q.options.forEach(opt => {
            html += `<label><input type="checkbox" data-q="${index}"> ${opt}</label>`;
          });
          html += `</div>`;
        }
		if (q.type === "dropdown") {
            html += `<select id="dropdown${index}" ${req}>`;
            html += `<option value="">-- Select --</option>`;
              q.options.forEach(opt => {
              html += `<option value="${opt}">${opt}</option>`;
            });
            html += `</select>`;
        }
		if (q.type === "gps") {
            html += `<div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap;">
            <button type="button" onclick="captureGPS(${index})">Get Current Location</button>
            <input type="text" id="gpslat${index}" placeholder="Latitude" readonly ${req} style="max-width:120px;">
            <input type="text" id="gpslng${index}" placeholder="Longitude" readonly ${req} style="max-width:120px;">
            <input type="text" id="gpsacc${index}" placeholder="Accuracy (m)" readonly style="max-width:120px;">
            </div>`;
        }
        if (q.type === "image") {
            html += `<div>
                <input type="file" id="image${index}" accept="image/*" ${req}>
            </div>`;
        }
        html += `
        <div class="actions">
            <button type="button" onclick="editQuestion(${index})">Edit</button>
            <button type="button" onclick="deleteQuestion(${index})">Delete</button>
        </div>`;
        html += `</div>`;
    });
    html += `
      <div class="form-actions">
        <button type="submit">Submit Survey</button>
        <button type="button" onclick="exportCSV()">Export CSV</button>
      </div>`;
    html += `</form>`;
    document.getElementById("previewArea").innerHTML = html;
    const previewCheckbox = document.getElementById("previewEditMode");
    previewCheckbox.addEventListener("change", () => {
        const show = previewCheckbox.checked;
        document.querySelectorAll("#previewArea .actions").forEach(a => {
            a.style.display = show ? "flex" : "none";
        });
    });
}

function validateForm() {
    let isValid = true;
    survey.questions.forEach((q, index) => {
        let errorSpan = document.getElementById(`error${index}`);
        if (!errorSpan) return;
        errorSpan.innerHTML = "";
        if (q.type === "email") {
            let email = document.getElementById(`email${index}`).value;
            let emailPattern = /^[^ ]+@[^ ]+\.[a-z]{2,3}$/;
            if (!emailPattern.test(email)) {
                errorSpan.innerHTML = "Invalid Email Address";
                isValid = false;
            }
        }
        if (q.type === "phone") {
            let phone = document.getElementById(`phone${index}`).value;
            let phonePattern = /^\+\d{10,15}$/;
            if (!phonePattern.test(phone)) {
                errorSpan.innerHTML = "Phone must be like +919401065598";
                isValid = false;
            }
        }
        if (q.type === "number") {
            let num = document.getElementById(`number${index}`).value;
            if (q.min !== null && num < q.min) {
                errorSpan.innerHTML = `Minimum allowed is ${q.min}`;
                isValid = false;
            }
            if (q.max !== null && num > q.max) {
                errorSpan.innerHTML = `Maximum allowed is ${q.max}`;
                isValid = false;
            }
        }
    });
    if (!isValid) alert("Please correct errors before submitting");
    return isValid;
}

async function downloadHTML() {
    const preview = document.getElementById("previewArea");
    const clone = preview.cloneNode(true);
    let formTag = clone.querySelector("form");
    if (formTag) {
        formTag.setAttribute("onsubmit", "return saveSubmission(event)");
    }
    clone.querySelectorAll(".actions").forEach(a => a.remove());
    const content = clone.innerHTML;
    const minifiedCSS = `
        body, input, select, textarea, button { font-size:13px; font-family:'Segoe UI',Arial,sans-serif; margin:0; }
        body { background:#f1f3f6; }
        button { padding:8px 13px; border-radius:6px; border:none; background:#2d7ff9; color:#fff; cursor:pointer; font-size:13px; }
        button:hover { background:#1b64d1; }
        .preview form { width:75%; margin:auto; background:#fff; padding:10px; border-radius:10px; border:1px solid #e0e0e0; }
        .question-block { background:#fafafa; padding:13px 15px; margin-bottom:13px; border-radius:8px; border:1px solid #eaeaea; display:flex; align-items:center; gap:13px; flex-wrap:wrap; }
        .question-block label { flex:1; min-width:180px; font-weight:700; }
        .question-block input, .question-block select, .question-block textarea { flex:2; width:100%; min-width:120px; padding:8px; border:1px solid #ccc; border-radius:6px; box-sizing:border-box; }
        .error { color:red; font-size:13px; width:100%; margin-top:5px; }
        .radio-group, .checkbox-group { display:flex; flex-direction:column; gap:4px; flex:2; min-width:120px; }
        .radio-group label, .checkbox-group label { display:flex; align-items:center; gap:5px; }
        .inline-submit-export { display:flex; align-items:center; gap:10px; margin-top:15px; }
    `;
    let cssText = minifiedCSS;
    try {
        const response = await fetch("style.css");
        if (response.ok) cssText = await response.text();
    } catch (e) {
        console.log("Could not load external CSS, using fallback");
    }
    const embeddedScript = `
    <script>
    let responses = [];
    function captureGPS(index) {
    if (!navigator.geolocation) {
        alert("Geolocation not supported by this browser.");
        return;
    }
    navigator.geolocation.getCurrentPosition(
        function (pos) {
            document.getElementById("gpslat" + index).value = pos.coords.latitude;
            document.getElementById("gpslng" + index).value = pos.coords.longitude;
            document.getElementById("gpsacc" + index).value = pos.coords.accuracy;
        },
        function (err) {
            alert("Unable to get location: " + err.message);
        }
      );
    }
    function saveSubmission(e) {
        e.preventDefault();
        const form = document.getElementById("surveyForm");
        const formData = {};
        const questions = form.querySelectorAll(".question-block");
        questions.forEach((block, index) => {
          const label = block.querySelector("label");
          const questionText = label ? label.innerText : "Question " + (index + 1);
          let answer = "";
          let lat = block.querySelector("input[id^='gpslat']");
          let lng = block.querySelector("input[id^='gpslng']");
        if (lat && lng) {
          let acc = block.querySelector("input[id^='gpsacc']");
          answer = lat.value && lng.value
            ? lat.value + ", " + lng.value + " (Accuracy: " + (acc ? acc.value : "") + "m)"
            : "Not answered";
          formData[questionText] = answer;
          return;
        }
    const input = block.querySelector("input, textarea, select");
    if (!input) return;
            if (["text","date","number","email"].includes(input.type) || ["textarea","select"].includes(input.tagName.toLowerCase())) {
                answer = input.value || "Not answered";
            } else if (input.type === "radio") {
                const checked = block.querySelector("input[type=radio]:checked");
                answer = checked ? checked.nextSibling.textContent.trim() : "Not answered";
            } else if (input.type === "checkbox") {
                const checks = block.querySelectorAll("input[type=checkbox]");
                const values = [];
                checks.forEach(c => { if(c.checked) values.push(c.nextSibling.textContent.trim()); });
                answer = values.length ? values.join(", ") : "Not answered";
            }
            formData[questionText] = answer;
        });
        responses.push(formData);
        let text = "Survey Title: " + document.title + "\\nSubmitted At: " + new Date().toLocaleString() + "\\n\\n";
        for (let key in formData) text += key + " : " + formData[key] + "\\n";
        const blob = new Blob([text], { type: "text/plain" });
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = "survey-response-" + Date.now() + ".txt";
        a.click();
        alert("Response saved successfully!");
        form.reset();
    }
    function exportCSV() {
        if (responses.length === 0) { alert("No responses recorded yet!"); return; }
        const keys = Object.keys(responses[0]);
        let csv = keys.join(",") + "\\n";
        responses.forEach(r => { csv += keys.map(k => '"' + (r[k]||"") + '"').join(",") + "\\n"; });
        const blob = new Blob([csv], { type: "text/csv" });
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = "survey_responses.csv";
        a.click();
    }
    </script>
    `;
    const fullHTML = `
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="UTF-8">
        <title>${document.getElementById("surveyTitle").value}</title>
        <style>${cssText}</style>
    </head>
    <body>
        ${content}
        ${embeddedScript}
    </body>
    </html>
    `;
    const blob = new Blob([fullHTML], { type: "text/html" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "survey.html";
    a.click();
    URL.revokeObjectURL(a.href);
}

function downloadPDF() {
    let element = document.getElementById("previewArea");
    let oldClass = element.className;
    element.className = "one-column";
    html2pdf()
        .from(element)
        .save("survey.pdf")
        .then(() => {
            element.className = oldClass;
        });
}

function saveSurveyJSON() {
    let blob = new Blob([JSON.stringify(survey, null, 2)], {
        type: "application/json"
    });
    let a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "survey.json";
    a.click();
}

function loadSurveyJSON(event) {
    let file = event.target.files[0];
    if (!file) return;
    let reader = new FileReader();
    reader.onload = function(e) {
        try {
            survey = JSON.parse(e.target.result);
            document.getElementById("surveyTitle").value = survey.title;
            generatePreview();
            alert("Survey loaded successfully!");
        } catch (err) {
            alert("Invalid survey JSON file");
        }
    };
    reader.readAsText(file);
}
let responses = [];

function submitResponses(event) {
    event.preventDefault();
    if (!validateForm()) return false;
    let formData = {};
    let googleData = new FormData();
    survey.questions.forEach((q, index) => {
        if (q.type === "pagebreak") return;
        let value = "";
        switch(q.type) {
            case "text":
                {
                    let el = document.getElementById(`text${index}`);
                    value = el ? el.value.trim() : "Not answered";
                }
                break;
            case "textarea":
                {
                    let el = document.getElementById(`textarea${index}`);
                    value = el ? el.value.trim() : "Not answered";
                }
                break;
            case "number":
                {
                    let el = document.getElementById(`number${index}`);
                    value = el ? el.value : "Not answered";
                }
                break;
            case "date":
                {
                    let el = document.getElementById(`date${index}`);
                    value = el ? el.value : "Not answered";
                }
                break;
            case "email":
                {
                    let el = document.getElementById(`email${index}`);
                    value = el ? el.value.trim() : "Not answered";
                }
                break;
            case "phone":
                {
                    let el = document.getElementById(`phone${index}`);
                    value = el ? el.value.trim() : "Not answered";
                }
                break;
            case "radio":
                {
                    let checked = document.querySelector(`input[name='q${index}']:checked`);
                    value = checked ? checked.nextSibling.textContent.trim() : "Not answered";
                }
                break;
            case "checkbox":
                {
                    let checks = document.querySelectorAll(`#surveyForm input[type='checkbox'][data-q='${index}']`);
                    let selected = [];
                    checks.forEach(c => {
                        if (c.checked) selected.push(c.nextSibling.textContent.trim());
                    });
                    value = selected.length ? selected.join(" | ") : "Not answered";
                }
                break;
            case "dropdown":
                {
                    let el = document.getElementById(`dropdown${index}`);
                    value = el ? (el.value || "Not answered") : "Not answered";
                }
                break;
            case "gps":
                {
                    let lat = document.getElementById(`gpslat${index}`);
                    let lng = document.getElementById(`gpslng${index}`);
                    let acc = document.getElementById(`gpsacc${index}`);
                    value = (lat && lng) ? 
                        lat.value + ", " + lng.value + " (Accuracy: " + (acc ? acc.value : "") + "m)"
                        : "Not answered";
                }
                break;
            case "image":
                {
                    let el = document.getElementById(`image${index}`);
                    if (el && el.files.length > 0) {
                        let file = el.files[0];
                        value = file.name;
                        let reader = new FileReader();
                        reader.onload = function () {
                            let base64 = reader.result.split(",")[1];
                            googleData.append("image_" + index, base64);
                            googleData.append("filename_" + index, file.name);
                            sendToGoogle(googleData);
                        };
                        reader.readAsDataURL(file);
                    } else {
                        value = "No image uploaded";
                    }
                }
                break;
            default:
                value = "Not answered";
        }
        formData[q.text] = value;
        googleData.append(q.text, value);
    });
    googleData.append("Timestamp", new Date().toLocaleString());
    responses.push(formData);
    let text = "Survey Title: " + survey.title + "\nSubmitted At: " + new Date().toLocaleString() + "\n\n";
    for (let key in formData) {
        text += key + " : " + formData[key] + "\n";
    }
    let blob = new Blob([text], { type: "text/plain" });
    let a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "survey-response-" + Date.now() + ".txt";
    a.click();
    sendToGoogle(googleData);
    alert("Response saved and sent successfully!");
    document.getElementById("surveyForm").reset();
    return false;
}

function sendToGoogle(formData) {
    return fetch("https://script.google.com/macros/s/AKfycbyoYnwE1VLSVwa2tjUIY0_7hjlkT2zGfYnBqOhRQJODj7V_fZeN1dTfX6pyG0L-3puJRA/exec", {
        method: "POST",
        mode: "no-cors",
        body: formData
    });
}

function exportCSV() {
    if (responses.length === 0) {
        alert("No responses recorded yet!");
        return;
    }
    let keys = Object.keys(responses[0]);
    let csv = keys.join(",") + "\n";
    responses.forEach(r => {
        let row = keys.map(k => `"${r[k] || ""}"`).join(",");
        csv += row + "\n";
    });
    let blob = new Blob([csv], { type: "text/csv" });
    let a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "survey_responses.csv";
    a.click();
}

function captureGPS(index) {
    if (!navigator.geolocation) {
        alert("Geolocation not supported by this browser.");
        return;
    }
    navigator.geolocation.getCurrentPosition(
        function (pos) {
            document.getElementById("gpslat" + index).value = pos.coords.latitude;
            document.getElementById("gpslng" + index).value = pos.coords.longitude;
            document.getElementById("gpsacc" + index).value = pos.coords.accuracy;
        },
        function (err) {
            alert("Unable to get location: " + err.message);
        }
    );
}

