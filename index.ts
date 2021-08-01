import { readFile } from 'fs/promises';
import fetch from 'node-fetch';

interface PatreonCampaign {
    data: {
        attributes: {
            avatar_photo_url: string
            /** Pledge amount per period in cents. */
            campaign_pledge_sum: number
            cover_photo_url: string
            cover_photo_url_sizes: { [key in 'large' | 'medium' | 'small']: string }
            created_at: string
            creation_count: number
            creation_name: string
            currency: string
            display_patron_goals: boolean
            earnings_visibility: 'public' | 'private'
            image_small_url: string
            image_url: string
            is_charge_upfront: boolean
            is_charged_immediately: boolean
            is_monthly: boolean
            is_nsfw: boolean
            is_plural: boolean
            main_video_embed: unknown
            main_video_url: unknown
            name: string
            one_liner: null | string
            outstanding_payment_amount_cents: null | number
            patron_count: number
            pay_per_name: string
            pledge_sum: number
            pledge_sum_currency: number
            pledge_url: string
            published_at: string
            summary: string
            url: string
        }
        id: string
        relationships: { creator: [Object], goals: [Object], rewards: [Object] } // not gonna bother tbh
        type: string
    },
    included: any[] // not gonna bother tbh
    links: { self: string }
}

let lastPledgeAmountCents = 0;

const readEnv = async () => {
    const env = await readFile('./.env', 'utf-8');
    for (const line of env.split('\r\n')) {
        const [key, value] = line.split('=');
        Object.defineProperty(process.env, key!, {
            value: value,
            enumerable: true
        });
    }
}

const sendWebhook = async (message: string) => {
    return await fetch(process.env.DISCORD_WEBHOOK!, {
        method: 'POST',
        body: JSON.stringify({
            content: message
        }),
        headers: { 'Content-Type': 'application/json' }
    });
}

const getCurrentBoost = async () => {
    const p = await fetch(`https://api.github.com/gists/${process.env.GIST_ID}`, {
        headers: {
            'Accept': 'application/vnd.github.v3+json'
        }
    });
    const j = await p.json(); // todo: interface?
    lastPledgeAmountCents = Number(j.files['SynergismQuarkBoost.txt'].content) * 1000;
}

const fetchPatreon = async () => {
    const r = await fetch('https://www.patreon.com/api/campaigns/4926360', {
        headers: {
            'Content-Type': 'application/vnd.api+json'
        }
    });

    if (!r.ok) return;

    const j = await r.json() as PatreonCampaign;
    if (j.data.attributes.campaign_pledge_sum !== lastPledgeAmountCents) { // someone donated
        const lastBonus = Math.floor(lastPledgeAmountCents / 100 / 10); // cents -> dollars -> bonus
        const nowBonus = Math.floor(j.data.attributes.campaign_pledge_sum / 100 / 10); // same as above

        if (nowBonus !== lastBonus) { // went over $10 threshold 
            lastPledgeAmountCents = j.data.attributes.campaign_pledge_sum;
            return true;
        }
    }

    return false;
}

const updateGist = async () => {
    if (!process.env.GIST_ID || !process.env.GITHUB_ACCESS_TOKEN)
        await readEnv();
    if (lastPledgeAmountCents === 0)
        await getCurrentBoost();

    const shouldUpdateGist = await fetchPatreon();
    if (typeof shouldUpdateGist !== 'boolean') { // error; bad response
        console.log(`\x1b[31m%s\x1b[0m`, 'Failed to fetch the Patreon API!');
        return sendWebhook('Failed to fetch Patreon API. 😕');
    }

    if (shouldUpdateGist === true) {
        console.log(`\x1b[32m%s\x1b[0m`, 'Updating the gist @ ', new Date());
        return await fetch(`https://api.github.com/gists/${process.env.GIST_ID}`, {
            method: 'PATCH',
            body: JSON.stringify({
                files: {
                    'SynergismQuarkBoost.txt': { 
                        content: Math.floor(lastPledgeAmountCents / 100 / 10).toString() 
                    }
                }
            }),
            headers: {
                'Authorization': `token ${process.env.GITHUB_ACCESS_TOKEN}`,
                'Accept': 'application/vnd.github.v3+json',
                'Content-Type': 'application/json'
            }
        });
    }

    console.log(`\x1b[35m%s\x1b[0m`, 'Did not update, skipped!');
}

const loop = async () => {
    try {
        await updateGist();
    } catch (e) {
        console.log(`\x1b[31m%s\x1b[0m`, e);
        return sendWebhook(e.toString());
    }
}

loop();
setInterval(loop, 60 * 1000 * 10); // 10 minutes