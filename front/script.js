document.getElementById("signupForm").addEventListener("submit", function (e) {
    e.preventDefault();

    document.getElementById("successModal").style.display = "flex";
});

document.getElementById("okBtn").addEventListener("click", function () {
    window.location.href = "login.html";
});

function togglePasswordVisibility(id) {
    const input = document.getElementById(id);
    if (input.type === "password") {
        input.type = "text";
    } else {
        input.type = "password";
    }
}
