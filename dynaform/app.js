let survey = {
    title: "",
    questions: []
};
let savedImageScript = null;
let savedDataScript= null;

function getImageScriptURL() {
    return savedImageScript ||
        "https://script.google.com/macros/s/AKfycbxbpP3pq_urYIIXngxbUHFdfYKEDHjmdnNC3aCs7YYOIP8R-1i4DFqyayASkFHyUchu/exec";
}

function getDataScriptURL() {
    return savedDataScript ||
        "https://script.google.com/macros/s/AKfycbx8UsKCFuViyT_Gdcv6OtpRUv4HFd6x2sgb1hLvhyPagT0iego7D6ZTIIi66jBe0_cc/exec";
}

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
                <input type="checkbox" id="previewEditMode"> Edit Mode
            </label>
        </div>
    `;
    html += `<form id="surveyForm" class="${twoColumn ? 'two-column' : 'one-column'}" onsubmit="return submitResponses(event)">`;
    survey.questions.forEach((q, index) => {
        if (q.type === "pagebreak") {
            html += `<div class="pagebreak"></div>`;
            return;
        }
		html += `<div class="question-block" draggable="false" data-index="${index}">`;
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
      </div>`;
    html += `</form>`;
    document.getElementById("previewArea").innerHTML = html;
    const previewCheckbox = document.getElementById("previewEditMode");
    previewCheckbox.addEventListener("change", () => {
    const enabled = previewCheckbox.checked;
    document.querySelectorAll("#previewArea .question-block").forEach(block => {
        block.draggable = enabled;
        if (enabled) {
            block.classList.add("draggable-enabled");
        } else {
            block.classList.remove("draggable-enabled");
        }
      });
    });
	previewCheckbox.addEventListener("change", () => {
    const show = previewCheckbox.checked;
    document.querySelectorAll("#previewArea .actions").forEach(a => {
        a.style.display = show ? "flex" : "none";
      });
    });
enableDragAndDrop();
applyImageScriptState();
}

function enableDragAndDrop() {
    let dragged = null;
    document.querySelectorAll("#previewArea .question-block").forEach(block => {
        block.addEventListener("dragstart", function (e) {
            dragged = this;
            this.classList.add("dragging");
            e.dataTransfer.effectAllowed = "move";
        });
        block.addEventListener("dragend", function () {
            this.classList.remove("dragging");
        });
        block.addEventListener("dragover", function (e) {
            e.preventDefault();
            this.classList.add("drag-over");
        });
        block.addEventListener("dragleave", function () {
            this.classList.remove("drag-over");
        });
        block.addEventListener("drop", function (e) {
            e.preventDefault();
            this.classList.remove("drag-over");
            if (dragged && dragged !== this) {
                let container = document.querySelector("#previewArea form");
                let blocks = Array.from(container.querySelectorAll(".question-block"));
                let fromIndex = blocks.indexOf(dragged);
                let toIndex = blocks.indexOf(this);
                if (fromIndex < toIndex) {
                    container.insertBefore(dragged, this.nextSibling);
                } else {
                    container.insertBefore(dragged, this);
                }
                let movedItem = survey.questions.splice(fromIndex, 1)[0];
                survey.questions.splice(toIndex, 0, movedItem);
                generatePreview();
            }
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
		if (q.type === "image" && q.required) {
            let el = document.getElementById(`image${index}`);
            if (!el || el.files.length === 0) {
                alert("Please upload required image: " + q.text);
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
    const imageScriptURL = savedImageScript ||
        "https://script.google.com/macros/s/AKfycbxbpP3pq_urYIIXngxbUHFdfYKEDHjmdnNC3aCs7YYOIP8R-1i4DFqyayASkFHyUchu/exec";
    const dataScriptURL = savedDataScript ||
        "https://script.google.com/macros/s/AKfycbx8UsKCFuViyT_Gdcv6OtpRUv4HFd6x2sgb1hLvhyPagT0iego7D6ZTIIi66jBe0_cc/exec";
    let formTag = clone.querySelector("form");
    if (formTag) {
        formTag.setAttribute("onsubmit", "return submitResponses(event)");
    }
    clone.querySelectorAll(".actions").forEach(a => a.remove());
    const content = clone.innerHTML;
    let cssText = `
body, input, select, textarea, button {
    font-size:13px;
    font-family:'Segoe UI',Arial,sans-serif;
}
body { background:#f1f3f6; }
button {
    padding:8px 13px;
    border-radius:6px;
    border:none;
    background:#2d7ff9;
    color:#fff;
    cursor:pointer;
}
button:hover { background:#1b64d1; }
form {
    width:75%;
    margin:auto;
    background:#fff;
    padding:10px;
    border-radius:10px;
}
`;
    try {
        const response = await fetch("style.css");
        if (response.ok) cssText = await response.text();
    } catch {}
const embeddedScript = `
let responses = [];
const DATA_SCRIPT_URL =
    document.getElementById("dataScriptURL").value;
const IMAGE_SCRIPT_URL =
    document.getElementById("imageScriptURL").value;
window.loadedSubmissions = [];
let savedDataScript = DATA_SCRIPT_URL;
function validateForm() { return true; }
function captureGPS(index) {
    if (!navigator.geolocation) {
        alert("Geolocation not supported");
        return;
    }
    navigator.geolocation.getCurrentPosition(pos => {
        document.getElementById("gpslat" + index).value = pos.coords.latitude;
        document.getElementById("gpslng" + index).value = pos.coords.longitude;
        document.getElementById("gpsacc" + index).value = pos.coords.accuracy;
    });
}
async function submitResponses(event) {
    event.preventDefault();
    const form = document.getElementById("surveyForm");
    let formData = {};
    let googleData = new FormData();
    let blocks = form.querySelectorAll(".question-block");
    let fileReadPromises = [];
    for (let i = 0; i < blocks.length; i++) {
        let block = blocks[i];
        let label = block.querySelector("label");
		let questionText = label 
    ? label.innerText.replace(/^\\\\d+\\\\.\\\\s*/, "").replace("*", "") 
    : "Question " + (i + 1);
        let answer = "Not answered";
        let lat = block.querySelector("input[id^='gpslat']");
        let lng = block.querySelector("input[id^='gpslng']");
        if (lat && lng) {
            let acc = block.querySelector("input[id^='gpsacc']");
            answer = lat.value && lng.value
                ? lat.value + ", " + lng.value + " (Accuracy: " + acc.value + "m)"
                : answer;
            formData[questionText] = answer;
            googleData.append(questionText, answer);
            continue;
        }
        let fileInput = block.querySelector("input[type='file']");
        if (fileInput) {
            if (fileInput.files.length) {
                let file = fileInput.files[0];
                answer = file.name;
                let p = new Promise(resolve => {
                    let r = new FileReader();
                    r.onload = () => {
                        googleData.append("image_" + i, r.result.split(",")[1]);
                        googleData.append("filename_" + i, file.name);
                        resolve();
                    };
                    r.readAsDataURL(file);
                });
                fileReadPromises.push(p);
            }
            formData[questionText] = answer;
            googleData.append(questionText, answer);
            continue;
        }
        let input = block.querySelector("input, textarea, select");
        if (input) {
            if (input.type === "radio") {
                let c = block.querySelector("input[type=radio]:checked");
                answer = c ? c.nextSibling.textContent.trim() : answer;
            } else if (input.type === "checkbox") {
                let v = [];
                block.querySelectorAll("input[type=checkbox]").forEach(c => {
                    if (c.checked) v.push(c.nextSibling.textContent.trim());
                });
                answer = v.length ? v.join(", ") : answer;
            } else {
                answer = input.value || answer;
            }
        }
        formData[questionText] = answer;
        googleData.append(questionText, answer);
    }
    googleData.append("Timestamp", new Date().toLocaleString());
    responses.push(formData);
    let text = "Survey Title: " + document.title + "\\n";
    text += "Submitted At: " + new Date().toLocaleString() + "\\n\\n";
    for (let k in formData)
        text += k + " : " + formData[k] + "\\n";
    const blob = new Blob([text], { type: "text/plain" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "survey-response-" + Date.now() + ".txt";
    a.click();
    await Promise.all(fileReadPromises);
    fetch(IMAGE_SCRIPT_URL, {
        method:"POST",
        mode:"no-cors",
        body:googleData
    });
    alert("Response saved");
    form.reset();
    return false;
}
function parseSubmissionText(text) {
    let lines = text.split(/\\r?\\n/);
    let result = {
        surveyTitle: "",
        submittedAt: "",
        fields: []
    };
    let currentField = null;
    for (let line of lines) {
        line = line.trim();
        if (line === "") continue;
        if (line.startsWith("Survey Title:")) {
            result.surveyTitle = line.replace("Survey Title:", "").trim();
            continue;
        }
        if (line.startsWith("Submitted At:")) {
            result.submittedAt = line.replace("Submitted At:", "").trim();
            continue;
        }
        if (line.startsWith("Upload Photo")) {
            currentField = null;
            continue;
        }
        if (line.includes(" : ")) {
            let parts = line.split(" : ");
            let label = parts[0].trim();
            let value = parts.slice(1).join(" : ").trim();
            let cleanLabel = label.replace(/^\\\\d+\\\\.\\\\s*/, "").replace(/\\\\*$/, "");
              currentField = {
              label: cleanLabel,
              value: value
            };
            result.fields.push(currentField);
        } else {
            if (currentField) {
                currentField.value += " " + line;
            }
        }
    }
    return result;
}
function loadSubmission() {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".txt";
    input.multiple = true;
    input.onchange = () => {
        const files = [...input.files];
        const totalFiles = files.length;
        loadedSubmissions = [];
        let count = 0;
        files.forEach(f => {
            const r = new FileReader();
            r.onload = ev => {
                loadedSubmissions.push(parseSubmissionText(ev.target.result));
                if (++count === totalFiles) {
                    showSubmissionsTable();
                }
            };
            r.readAsText(f);
        });
    };
    input.click();
}
function showSubmissionsTable() {
    let popup = window.open("", "Submissions", "width=900,height=600");
    let html = \`
        <html>
        <head>
            <title>Form Submissions</title>
            <style>
                body { font-family: Arial; padding: 10px; }
                table { border-collapse: collapse; width: 100%; }
                th, td { border: 1px solid #ccc; padding: 6px; text-align: left; }
                th { background: #f2f2f2; }
                button { padding: 6px; margin: 4px; }
            </style>
        </head>
        <body>
        <h3>Parsed Submissions</h3>
        <table>
            <tr>
                <th>Survey Title</th>
                <th>Submitted At</th>
                <th>Data</th>
                <th>Action</th>
            </tr>
    \`;
    window.loadedSubmissions.forEach((sub, index) => {
        let fieldText = sub.fields
            .map(f => \`<b>\${f.label}</b>: \${f.value}\`)
            .join("<br>");
        html += \`
            <tr>
                <td>\${sub.surveyTitle}</td>
                <td>\${sub.submittedAt}</td>
                <td>\${fieldText}</td>
                <td>
                    <button onclick="uploadParsedSubmission(\${index})">
                        Send to Google Sheet
                    </button>
                </td>
            </tr>
        \`;
    });
    html += \`
        </table>
        <script>
        window.submissions = window.opener.loadedSubmissions;
        function uploadParsedSubmission(index) {
            let sub = window.submissions[index];
            let payload = {
                "Survey Title": sub.surveyTitle,
                "Submitted At": sub.submittedAt
            };
            sub.fields.forEach(f => {
            let cleanLabel = f.label.replace(/^\\\\d+\.\\\\s*/, "").replace(/\\\\*$/, "");
               payload[cleanLabel] = f.value;
            });
            console.log("Sending payload:", payload);
            const url = window.opener
              ? window.opener.document.getElementById("dataScriptURL").value
              : null;

            if (!url) {
              alert("Google Script URL not available.");
              return;
            }
        fetch(url, {
          method: "POST",
          mode: "no-cors",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify(payload)
        })
            .then(() => {
                alert("Submission sent to Google Sheet successfully");
            })
            .catch(err => {
                alert("Error sending to Google: " + err);
                console.log(err);
            });
        }
        <\\/script>
        </body>
        </html>
    \`;
    popup.document.write(html);
}
`;
const doc = document.implementation.createHTMLDocument("");
doc.documentElement.innerHTML = `
<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<title>${document.getElementById("surveyTitle").value}</title>
<style>${cssText}</style>
</head>
<body>
<input type="hidden" id="imageScriptURL" value="${imageScriptURL}">
<input type="hidden" id="dataScriptURL" value="${dataScriptURL}">
<div style="text-align:center;margin:15px;">
    <button type="button" onclick="loadSubmission()">Upload Submissions</button>
</div>
${content}
<script>
${embeddedScript}
</script>
</body>
</html>
`;
    const blob = new Blob(
        ["<!DOCTYPE html>\n" + doc.documentElement.outerHTML],
        { type: "text/html" }
    );
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "survey.html";
    a.click();
    URL.revokeObjectURL(a.href);
}

function downloadPDF() {
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF("p", "mm", "a4");
    const pageWidth = 210;
    const pageHeight = 297;
    const marginLeft = 15;
    const marginRight = 15;
    const marginTop = 20;
    const marginBottom = 20;
    const usableWidth = pageWidth - marginLeft - marginRight;
    const usableHeight = pageHeight - marginTop - marginBottom;
    let y = marginTop;
    let pageNumber = 1;
    pdf.setFont("NotoSansBengali", "normal");
    pdf.setFontSize(16);
    pdf.text(survey.title, pageWidth / 2, y, { align: "center" });
    y += 12;
    pdf.setFont("NotoSansBengali", "normal");
    pdf.setFontSize(11);
    let qNo = 1;
    survey.questions.forEach(q => {
        if (q.type === "pagebreak") {
            pdf.addPage();
            pageNumber++;
            y = marginTop;
            return;
        }
        let questionText = `${qNo}. ${q.text}${q.required ? " *" : ""}`;
        let splitText = pdf.splitTextToSize(questionText, usableWidth);
        let requiredHeight = splitText.length * 6 + 6;
        if (y + requiredHeight > pageHeight - marginBottom) {
            pdf.addPage();
            pageNumber++;
            y = marginTop;
        }
        pdf.text(splitText, marginLeft, y);
        y += splitText.length * 6 + 4;
        if (["text","email","number","phone","date","dropdown"].includes(q.type)) {
            pdf.line(marginLeft, y, pageWidth - marginRight, y);
            y += 8;
        }
        if (q.type === "textarea") {
            for (let i = 0; i < 3; i++) {
                pdf.line(marginLeft, y, pageWidth - marginRight, y);
                y += 8;
            }
        }
        if (q.type === "radio") {
            q.options.forEach(opt => {
                if (y + 8 > pageHeight - marginBottom) {
                    pdf.addPage();
                    pageNumber++;
                    y = marginTop;
                }
                pdf.circle(marginLeft + 2, y - 2, 2);
                pdf.text(opt, marginLeft + 8, y);
                y += 7;
            });
        }
        if (q.type === "checkbox") {
            q.options.forEach(opt => {
                if (y + 8 > pageHeight - marginBottom) {
                    pdf.addPage();
                    pageNumber++;
                    y = marginTop;
                }
                pdf.rect(marginLeft, y - 4, 4, 4);
                pdf.text(opt, marginLeft + 8, y);
                y += 7;
            });
        }
        y += 4;
        qNo++;
    });
    const totalPages = pdf.getNumberOfPages();
    for (let i = 1; i <= totalPages; i++) {
        pdf.setPage(i);
        pdf.setFontSize(9);
        pdf.text(
            `Page ${i} of ${totalPages}`,
            pageWidth / 2,
            pageHeight - 10,
            { align: "center" }
        );
    }
    pdf.save(survey.title.replace(/\s+/g,"_") + ".pdf");
}

function saveSurveyJSON() {
    const exportSurvey = {
        title: survey.title,
        questions: survey.questions
    };
    if (savedImageScript) {
        exportSurvey.imageScript = savedImageScript;
    }
    let blob = new Blob([JSON.stringify(exportSurvey, null, 2)], {
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
        const loaded = JSON.parse(e.target.result);
        survey.title = loaded.title || "";
        survey.questions = loaded.questions || [];
        document.getElementById("surveyTitle").value = survey.title;
        flushImageScriptMemory();
        if (loaded.imageScript) {
            savedImageScript = loaded.imageScript;
        }
        applyImageScriptState();
        generatePreview();
        alert("Survey loaded successfully!");
    } catch (err) {
        alert("Invalid survey JSON file");
    }
};
    reader.readAsText(file);
}
let responses = [];

async function submitResponses(event) {
    event.preventDefault();
    if (!validateForm()) return false;
    let formData = {};
    let googleData = new FormData();
    let fileReadPromises = [];
    for (let index = 0; index < survey.questions.length; index++) {
        let q = survey.questions[index];
        if (q.type === "pagebreak") continue;
        let value = "";
        switch(q.type) {
            case "text":
            case "textarea":
            case "number":
            case "date":
            case "email":
            case "phone":
            case "dropdown":
                {
                    let el = document.querySelector(`#surveyForm [id$="${index}"]`);
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
                        let promise = new Promise((resolve) => {
                            let reader = new FileReader();
                            reader.onload = function () {
                                let base64 = reader.result.split(",")[1];
                                googleData.append("image_" + index, base64);
                                googleData.append("filename_" + index, file.name);
                                resolve();
                            };
                            reader.readAsDataURL(file);
                        });
                        fileReadPromises.push(promise);
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
    }
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
    await Promise.all(fileReadPromises);
    sendToGoogle(googleData);
    alert("Response saved and sent successfully!");
    document.getElementById("surveyForm").reset();
    return false;
}

function sendToGoogle(formData) {
    const url = getImageScriptURL();
    return fetch(url, {
        method: "POST",
        mode: "no-cors",
        body: formData
    });
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

function parseSubmissionText(text) {
    let lines = text.split(/\r?\n/);
    let result = {
        surveyTitle: "",
        submittedAt: "",
        fields: []
    };
    let currentField = null;
    for (let line of lines) {
        line = line.trim();
        if (line === "") continue;
        if (line.startsWith("Survey Title:")) {
            result.surveyTitle = line.replace("Survey Title:", "").trim();
            continue;
        }
        if (line.startsWith("Submitted At:")) {
            result.submittedAt = line.replace("Submitted At:", "").trim();
            continue;
        }
        if (line.startsWith("Upload Photo")) {
            currentField = null;
            continue;
        }
        if (line.includes(" : ")) {
            let parts = line.split(" : ");
            let label = parts[0].trim();
            let value = parts.slice(1).join(" : ").trim();
            currentField = {
                label: label,
                value: value
            };
            result.fields.push(currentField);
        } else {
            if (currentField) {
                currentField.value += " " + line;
            }
        }
    }
    return result;
}

function loadSubmission() {
    let input = document.createElement("input");
    input.type = "file";
    input.accept = ".txt";
    input.multiple = true;
    input.onchange = function(event) {
        let files = event.target.files;
        let submissions = [];
        let readCount = 0;
        for (let file of files) {
            let reader = new FileReader();
            reader.onload = function(e) {
                let text = e.target.result;
                let parsed = parseSubmissionText(text);
                submissions.push(parsed);
                readCount++;
                if (readCount === files.length) {
					window.loadedSubmissions = submissions;
                    showSubmissionsTable(submissions);
                }
            };
            reader.readAsText(file);
        }
    };
    input.click();
}

function showSubmissionsTable() {
    let popup = window.open("", "Submissions", "width=900,height=600");
    let html = `
        <html>
        <head>
            <title>Form Submissions</title>
            <style>
                body { font-family: Arial; padding: 10px; }
                table { border-collapse: collapse; width: 100%; }
                th, td { border: 1px solid #ccc; padding: 6px; text-align: left; }
                th { background: #f2f2f2; }
                button { padding: 6px; margin: 4px; }
            </style>
        </head>
        <body>
        <h3>Parsed Submissions</h3>
        <input type="hidden" id="dataScript" 
               value="${document.getElementById('dataScript').value}">
        <table>
            <tr>
                <th>Survey Title</th>
                <th>Submitted At</th>
                <th>Data</th>
                <th>Action</th>
            </tr>
    `;
    window.loadedSubmissions.forEach((sub, index) => {
        let fieldText = sub.fields
            .map(f => `<b>${f.label}</b>: ${f.value}`)
            .join("<br>");
        html += `
            <tr>
                <td>${sub.surveyTitle}</td>
                <td>${sub.submittedAt}</td>
                <td>${fieldText}</td>
                <td>
                    <button onclick="uploadParsedSubmission(${index})">
                        Send to Google Sheet
                    </button>
                </td>
            </tr>
        `;
    });
    html += `
        </table>
        <script>
        window.submissions = ${JSON.stringify(window.loadedSubmissions)};
        function uploadParsedSubmission(index) {
            let sub = window.submissions[index];
            let payload = {
                "Survey Title": sub.surveyTitle,
                "Submitted At": sub.submittedAt
            };
            sub.fields.forEach(f => {
                payload[f.label] = f.value;
            });
            console.log("Sending payload:", payload);
            const url = document.getElementById("dataScript").value;
            if (!url) {
                alert("Google Script URL not configured in main form.");
                return;
            }
            fetch(url, {
                method: "POST",
                mode: "no-cors",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify(payload)
            })
            .then(() => {
                alert("Submission sent to Google Sheet successfully");
            })
            .catch(err => {
                alert("Error sending to Google: " + err);
                console.log(err);
            });
        }
        </script>
        </body>
        </html>
    `;
    popup.document.write(html);
}

document.addEventListener("DOMContentLoaded", () => {
    const twoColumnCheckbox = document.getElementById("twoColumn");
    if (twoColumnCheckbox) {
        twoColumnCheckbox.addEventListener("change", generatePreview);
    }
    populateConnectionsDropdown();
});

function saveIScript() {
    const input = document.getElementById("imageScript");
    if (!input) return;
    const value = input.value.trim();
    if (!value) {
        alert("Please enter script content first");
        return;
    }
    savedImageScript = value;
    input.disabled = true;
}

function applyImageScriptState() {
    const input = document.getElementById("imageScript");
    if (!input) return;
    if (savedImageScript !== null) {
        input.value = savedImageScript;
        input.disabled = true;
    } else {
        input.value = "";
        input.disabled = false;
    }
}

function saveDScript() {
    const input = document.getElementById("dataScript");
    if (!input) return;
    const value = input.value.trim();
    if (!value) {
        alert("Please enter script content first");
        return;
    }
    savedDataScript = value;
    input.disabled = true;
}

function applyDataScriptState() {
    const input = document.getElementById("dataScript");
    if (!input) return;
    if (savedDataScript !== null) {
        input.value = savedDataScript;
        input.disabled = true;
    } else {
        input.value = "";
        input.disabled = false;
    }
}

function flushImageScriptMemory() {
    savedImageScript = null;
    savedDataScript = null;
    const imageInput = document.getElementById("imageScript");
    if (imageInput) {
        imageInput.value = "";
        imageInput.disabled = false;
    }
    const dataInput = document.getElementById("dataScript");
    if (dataInput) {
        dataInput.value = "";
        dataInput.disabled = false;
    }
}







