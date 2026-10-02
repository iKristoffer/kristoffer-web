// ---------------------------------------------------------------------------
// Kortet: tomt pergament, der fyldes ud, mens man udforsker. Rent canvas — ingen three.js.
//   seen[]  = hvilke celler af øen spilleren (eller Siku) har set
//   base    = terrænet tegnet én gang, afsløres gennem en blød maske
// ---------------------------------------------------------------------------

const PARCHMENT = '#e8dcc0';
const INK = '#4a3a24';

export class ExploreMap {
    /** @param groundHeight (x,z) => højde. @param R verdens radius. @param cell celle-størrelse i verdensenheder. */
    constructor(groundHeight, R = 108, cell = 2.5) {
        this.R = R;
        this.cell = cell;
        this.n = Math.ceil((2 * R) / cell);
        this.seen = new Uint8Array(this.n * this.n);
        this.count = 0;
        this.base = this.#buildBase(groundHeight, 280);
        this.mask = document.createElement('canvas');
        this.mask.width = this.mask.height = this.n;
        this.maskDirty = true;
        this.tmp = document.createElement('canvas');
    }

    #buildBase(gh, px) {
        const cv = document.createElement('canvas');
        cv.width = cv.height = px;
        const g = cv.getContext('2d');
        const img = g.createImageData(px, px);
        const step = (2 * this.R) / px;
        const h = new Float32Array(px * px);
        for (let j = 0; j < px; j++) for (let i = 0; i < px; i++) h[j * px + i] = gh(-this.R + (i + 0.5) * step, -this.R + (j + 0.5) * step);
        for (let j = 0; j < px; j++) {
            for (let i = 0; i < px; i++) {
                const v = h[j * px + i];
                // Skråbelysning fra nordvest, så bjerge får relief
                const dx = (h[j * px + Math.min(px - 1, i + 1)] - h[j * px + Math.max(0, i - 1)]);
                const dz = (h[Math.min(px - 1, j + 1) * px + i] - h[Math.max(0, j - 1) * px + i]);
                const shade = Math.max(-0.35, Math.min(0.35, (-dx - dz) * 0.09));
                let c;
                if (v < -1.2) c = [118, 154, 176];           // åbent hav / havis
                else if (v < 0.05) c = [168, 192, 198];      // tyndis og strand
                else if (v < 4) c = [221, 208, 172];         // lavland
                else if (v < 9) c = [190, 168, 124];         // højland
                else c = [150, 126, 90];                    // fjeld
                const o = (j * px + i) * 4;
                img.data[o] = Math.max(0, Math.min(255, c[0] * (1 + shade)));
                img.data[o + 1] = Math.max(0, Math.min(255, c[1] * (1 + shade)));
                img.data[o + 2] = Math.max(0, Math.min(255, c[2] * (1 + shade)));
                img.data[o + 3] = 255;
            }
        }
        g.putImageData(img, 0, 0);
        return cv;
    }

    /** Afslør celler inden for r. Returnerer true, hvis noget nyt kom frem. */
    reveal(x, z, r) {
        const n = this.n, c = this.cell, R = this.R;
        const i0 = Math.max(0, Math.floor((x - r + R) / c)), i1 = Math.min(n - 1, Math.floor((x + r + R) / c));
        const j0 = Math.max(0, Math.floor((z - r + R) / c)), j1 = Math.min(n - 1, Math.floor((z + r + R) / c));
        let changed = false;
        for (let j = j0; j <= j1; j++) {
            for (let i = i0; i <= i1; i++) {
                const cx = -R + (i + 0.5) * c, cz = -R + (j + 0.5) * c;
                if ((cx - x) ** 2 + (cz - z) ** 2 > r * r) continue;
                if (!this.seen[j * n + i]) { this.seen[j * n + i] = 1; this.count++; changed = true; }
            }
        }
        if (changed) this.maskDirty = true;
        return changed;
    }

    isSeen(x, z) {
        const i = Math.floor((x + this.R) / this.cell), j = Math.floor((z + this.R) / this.cell);
        return i >= 0 && j >= 0 && i < this.n && j < this.n && this.seen[j * this.n + i] === 1;
    }

    /** Andel af kortet (landceller + hav) der er set, 0..1 af cirklen. */
    get fraction() {
        return Math.min(1, this.count / (Math.PI * (this.R / this.cell) ** 2));
    }

    #updateMask() {
        const g = this.mask.getContext('2d');
        const img = g.createImageData(this.n, this.n);
        for (let k = 0; k < this.seen.length; k++) {
            img.data[k * 4 + 3] = this.seen[k] ? 255 : 0;
        }
        g.putImageData(img, 0, 0);
        this.maskDirty = false;
    }

    /** Tegn kortet i canvas `cv` (kvadratisk). marks = [{x,z,icon,label?,color?,big?}], player = {x,z,yaw}. */
    draw(cv, marks, player) {
        const S = cv.width;
        const g = cv.getContext('2d');
        if (this.maskDirty) this.#updateMask();
        // Pergament
        g.fillStyle = PARCHMENT;
        g.fillRect(0, 0, S, S);
        const grd = g.createRadialGradient(S / 2, S / 2, S * 0.3, S / 2, S / 2, S * 0.75);
        grd.addColorStop(0, 'rgba(120,90,50,0)');
        grd.addColorStop(1, 'rgba(120,90,50,0.32)');
        g.fillStyle = grd;
        g.fillRect(0, 0, S, S);
        // Terræn gennem en blød maske
        this.tmp.width = this.tmp.height = S;
        const t = this.tmp.getContext('2d');
        t.imageSmoothingEnabled = true;
        t.clearRect(0, 0, S, S);
        t.drawImage(this.base, 0, 0, S, S);
        t.globalCompositeOperation = 'destination-in';
        if ('filter' in t) t.filter = `blur(${Math.max(2, S / 70)}px)`;
        t.drawImage(this.mask, 0, 0, S, S);
        t.filter = 'none';
        t.globalCompositeOperation = 'source-over';
        g.drawImage(this.tmp, 0, 0);
        // Ramme
        g.strokeStyle = INK;
        g.lineWidth = 3;
        g.strokeRect(6, 6, S - 12, S - 12);
        g.lineWidth = 1;
        g.strokeRect(11, 11, S - 22, S - 22);

        const px = (x) => ((x + this.R) / (2 * this.R)) * S;
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        for (const m of marks) {
            const x = px(m.x), y = px(m.z);
            g.font = `${m.big ? 26 : 20}px serif`;
            if (m.color) {
                g.fillStyle = m.color;
                g.globalAlpha = 0.35;
                g.beginPath();
                g.arc(x, y, m.big ? 17 : 13, 0, Math.PI * 2);
                g.fill();
                g.globalAlpha = 1;
            }
            g.fillStyle = INK;
            g.fillText(m.icon, x, y);
            if (m.label) {
                g.font = 'italic 12px Georgia, serif';
                g.lineWidth = 3;
                g.strokeStyle = 'rgba(232,220,192,.9)';
                g.strokeText(m.label, x, y + 20);
                g.fillText(m.label, x, y + 20);
            }
        }
        if (player) {
            const x = px(player.x), y = px(player.z);
            g.save();
            g.translate(x, y);
            g.rotate(Math.atan2(Math.cos(player.yaw), Math.sin(player.yaw)) - Math.PI / 2 + Math.PI);
            g.fillStyle = '#b3261e';
            g.strokeStyle = '#fff';
            g.lineWidth = 2;
            g.beginPath();
            g.moveTo(0, -11);
            g.lineTo(8, 9);
            g.lineTo(0, 5);
            g.lineTo(-8, 9);
            g.closePath();
            g.stroke();
            g.fill();
            g.restore();
        }
    }
}
