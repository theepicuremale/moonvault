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

    // Reveal the surprise block after the celebration moment lands.
    setTimeout(() => {
        const block = document.getElementById('surprise-block')
        if (block) block.hidden = false
    }, 1800)

    // ===== passcode gate for the OurFlix surprise =====
    // Inline morph: click button -> button hides, password field appears.
    // Password is case-insensitive. Wrong attempts shake + show hint.
    const SURPRISE_PASS = 'ourflix'
    const surpriseBtn = document.getElementById('surprise-btn')
    const surpriseBlock = document.getElementById('surprise-block')
    const surpriseForm = document.getElementById('surprise-form')
    const surpriseInput = document.getElementById('surprise-passcode')
    const surpriseError = document.getElementById('surprise-error')
    const surpriseHint = document.getElementById('surprise-hint')
    let surpriseFails = 0

    if (surpriseBtn && surpriseForm && surpriseInput) {
        surpriseBtn.addEventListener('click', () => {
            // Warm the OurFlix shell + Tum Ho cache the moment the user
            // engages with the surprise. By the time they type the password,
            // the next page is already loading in the background.
            try {
                fetch('ourflix.html', { credentials: 'same-origin' }).catch(() => {});
                fetch('gallery.css', { credentials: 'same-origin' }).catch(() => {});
                fetch('gallery.js', { credentials: 'same-origin' }).catch(() => {});
                fetch('assets/manifest.json', { credentials: 'same-origin' }).catch(() => {});
                // Pre-fetch the music file so playback on slideshow / hero
                // mute is instant. Service worker stores it in MUSIC_CACHE.
                fetch('music/Tum Ho Rockstar 128 Kbps.mp3', { credentials: 'same-origin' }).catch(() => {});
            } catch (_) {}

            surpriseBtn.classList.add('is-morphing')
            setTimeout(() => {
                surpriseBtn.hidden = true
                surpriseForm.hidden = false
                surpriseInput.focus()
            }, 180)
        })

        surpriseForm.addEventListener('submit', (e) => {
            e.preventDefault()
            const v = (surpriseInput.value || '').trim().toLowerCase()
            if (v === SURPRISE_PASS) {
                surpriseError.textContent = ''
                location.href = 'ourflix.html'
            } else {
                surpriseFails += 1
                surpriseError.textContent = "That's not it. Try again? 💭"
                if (surpriseFails >= 2 && surpriseHint) surpriseHint.hidden = false
                surpriseInput.value = ''
                surpriseInput.focus()
                surpriseBlock.classList.remove('shake')
                void surpriseBlock.offsetWidth
                surpriseBlock.classList.add('shake')
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




