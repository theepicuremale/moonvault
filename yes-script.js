let musicPlaying = false

window.addEventListener('load', () => {
    launchConfetti()

    // Autoplay music (works since user clicked Yes to get here)
    const music = document.getElementById('bg-music')
    music.volume = 0.3
    music.play().catch(() => {})
    musicPlaying = true
    document.getElementById('music-toggle').textContent = '🔊'
    
    sendNotification()

    // Reveal the surprise button after the celebration moment lands.
    setTimeout(() => {
        const btn = document.getElementById('surprise-btn')
        if (btn) btn.hidden = false
    }, 1800)

    // ===== passcode gate for the OurFlix surprise =====
    const SURPRISE_PASS = 'Nameevi'
    const surpriseBtn = document.getElementById('surprise-btn')
    const surpriseModal = document.getElementById('surprise-modal')
    if (surpriseBtn && surpriseModal) {
        const form = document.getElementById('surprise-form')
        const input = document.getElementById('surprise-passcode')
        const errorEl = document.getElementById('surprise-error')
        const closeBtn = surpriseModal.querySelector('.surprise-close')

        function openSurprise() {
            surpriseModal.hidden = false
            surpriseModal.setAttribute('aria-hidden', 'false')
            errorEl.textContent = ''
            input.value = ''
            requestAnimationFrame(() => {
                surpriseModal.classList.add('is-open')
                input.focus()
            })
        }
        function closeSurprise() {
            surpriseModal.classList.remove('is-open')
            setTimeout(() => {
                surpriseModal.hidden = true
                surpriseModal.setAttribute('aria-hidden', 'true')
            }, 220)
        }
        function onKey(e) {
            if (e.key === 'Escape' && !surpriseModal.hidden) closeSurprise()
        }

        surpriseBtn.addEventListener('click', openSurprise)
        closeBtn.addEventListener('click', closeSurprise)
        surpriseModal.addEventListener('click', (e) => {
            if (e.target === surpriseModal) closeSurprise()
        })
        document.addEventListener('keydown', onKey)
        form.addEventListener('submit', (e) => {
            e.preventDefault()
            const v = (input.value || '').trim()
            if (v === SURPRISE_PASS) {
                errorEl.textContent = ''
                location.href = 'ourflix.html'
            } else {
                errorEl.textContent = "That's not it. Try again? 💭"
                input.value = ''
                input.focus()
                surpriseModal.querySelector('.surprise-card').classList.remove('shake')
                // Trigger reflow so the animation can re-run.
                void surpriseModal.offsetWidth
                surpriseModal.querySelector('.surprise-card').classList.add('shake')
            }
        })
    }
})

function launchConfetti() {
    const colors = ['#ff69b4', '#ff1493', '#ff85a2', '#ffb3c1', '#ff0000', '#ff6347', '#fff', '#ffdf00']
    const duration = 6000
    const end = Date.now() + duration

    // Initial big burst
    confetti({
        particleCount: 150,
        spread: 100,
        origin: { x: 0.5, y: 0.3 },
        colors
    })

    // Continuous side cannons
    const interval = setInterval(() => {
        if (Date.now() > end) {
            clearInterval(interval)
            return
        }

        confetti({
            particleCount: 40,
            angle: 60,
            spread: 55,
            origin: { x: 0, y: 0.6 },
            colors
        })

        confetti({
            particleCount: 40,
            angle: 120,
            spread: 55,
            origin: { x: 1, y: 0.6 },
            colors
        })
    }, 300)
}

function toggleMusic() {
    const music = document.getElementById('bg-music')
    if (musicPlaying) {
        music.pause()
        musicPlaying = false
        document.getElementById('music-toggle').textContent = '🔇'
    } else {
        music.play()
        musicPlaying = true
        document.getElementById('music-toggle').textContent = '🔊'
    }
}

async function sendNotification() {
    function getDevice() {
        const ua = navigator.userAgent.toLowerCase();

        if (ua.includes("iphone")) return "iPhone";
        if (ua.includes("ipad")) return "iPad";
        if (ua.includes("android")) return "Android";
        if (ua.includes("windows")) return "Windows PC";
        if (ua.includes("mac")) return "Mac";

        return "Unknown";
    }

    const time = new Date().toLocaleString();
    const device = getDevice();
    const ipRes = await fetch("https://ipapi.co/json/");
    const ipData = await ipRes.json();
    
    const message = `YES clicked 🎉 | Time: ${time} | Device: ${device} | IP: ${ipData.ip}`;

    console.log("Sending:", message); // 🔥 TEST LINE
    
    await fetch(
        "https://docs.google.com/forms/d/e/1FAIpQLScIms1aon2hHUF9MuTZ4Y8nYan8lka3ojvMv7oHHFvUE9QTGw/formResponse",
        {
            method: "POST",
            mode: "no-cors",
            headers: {
                "Content-Type": "application/x-www-form-urlencoded"
            },
            body: "entry.1756652319=" + encodeURIComponent(message)
        }
    );

    console.log("Sent to Google Forms");

}




