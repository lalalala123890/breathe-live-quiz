import { getStore } from '@netlify/blobs';

const store = getStore('breathe-live-quiz');

const json = (x, status = 200) =>
  new Response(JSON.stringify(x), {
    status,
    headers: {
      'content-type': 'application/json',
      'cache-control': 'no-store'
    }
  });

const keyRoom = c => `room/${c}`;
const keyPlayer = (c, p) => `player/${c}/${p}`;

const cleanCode = x =>
  String(x || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 5);

const cleanName = x =>
  String(x || '')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim()
    .slice(0, 16);

const read = async key => await store.get(key, { type: 'json' });

export default async req => {
  try {
    const body =
      req.method === 'POST'
        ? await req.json().catch(() => ({}))
        : Object.fromEntries(new URL(req.url).searchParams);

    const action = body.action || 'get';
    const code = cleanCode(body.code);

    if (!code) {
      return json({ ok: false, error: 'Missing room code.' }, 400);
    }

    // CREATE ROOM
    if (action === 'create') {
      const hostToken = String(body.hostToken || '');

      if (hostToken.length < 16) {
        return json(
          { ok: false, error: 'Invalid host token.' },
          400
        );
      }

      const room = {
        code,
        hostToken,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        state: {
          ph: 'setup',
          i: -1,
          n: 10,
          T: 20
        }
      };

      await store.set(
        keyRoom(code),
        JSON.stringify(room)
      );

      return json({
        ok: true,
        room: room.state
      });
    }

    // FIND ROOM
    const room = await read(keyRoom(code));

    if (!room) {
      return json(
        {
          ok: false,
          error: 'Room not found. Create a new room.'
        },
        404
      );
    }

    // ROOM EXPIRES AFTER 6 HOURS
    if (Date.now() - room.createdAt > 6 * 60 * 60 * 1000) {
      return json(
        {
          ok: false,
          error: 'This room expired. Create a new room.'
        },
        410
      );
    }

    // HOST UPDATE
    if (action === 'host') {
      if (String(body.hostToken || '') !== room.hostToken) {
        return json(
          {
            ok: false,
            error: 'Host authorization failed.'
          },
          403
        );
      }

      room.state = body.state || room.state;
      room.updatedAt = Date.now();

      await store.set(
        keyRoom(code),
        JSON.stringify(room)
      );

      return json({
        ok: true,
        state: room.state
      });
    }

    // STUDENT JOIN
    if (action === 'join') {
      const name = cleanName(body.name);
      const playerToken = String(body.playerToken || '');

      if (!name || playerToken.length < 16) {
        return json(
          {
            ok: false,
            error: 'Enter a name.'
          },
          400
        );
      }

      const player = {
        id: playerToken,
        name,
        score: 0,
        qi: -1,
        a: -1,
        joinedAt: Date.now(),
        seenAt: Date.now()
      };

      await store.set(
        keyPlayer(code, playerToken),
        JSON.stringify(player)
      );

      return json({
        ok: true,
        state: room.state,
        player
      });
    }

    // STUDENT PRESENCE / ANSWER
    if (action === 'presence' || action === 'answer') {
      const playerToken = String(body.playerToken || '');
      const p = await read(
        keyPlayer(code, playerToken)
      );

      if (!p) {
        return json(
          {
            ok: false,
            error: 'Player session not found. Join again.'
          },
          404
        );
      }

      if (action === 'presence') {
        Object.assign(p, body.data || {});
      } else {
        Object.assign(p, {
          a: Number(body.k),
          qi: Number(body.i)
        });
      }

      p.seenAt = Date.now();

      await store.set(
        keyPlayer(code, playerToken),
        JSON.stringify(p)
      );

      return json({
        ok: true,
        player: p
      });
    }

    // LEAVE
    if (action === 'leave') {
      const playerToken = String(body.playerToken || '');

      try {
        await store.delete(
          keyPlayer(code, playerToken)
        );
      } catch {}

      return json({ ok: true });
    }

    // GET ROOM + PLAYERS
    const list = await store.list({
      prefix: `player/${code}/`
    });

    const players = [];

    for (const b of list.blobs) {
      const p = await read(b.key);

      if (
        p &&
        Date.now() -
          Number(p.seenAt || p.joinedAt || 0) <
          15000
      ) {
        players.push(p);
      }
    }

    return json({
      ok: true,
      state: room.state,
      players
    });
  } catch (e) {
    return json(
      {
        ok: false,
        error: String(e?.message || e)
      },
      500
    );
  }
};
