import { FastifyInstance } from 'fastify';
import { firestore } from '../lib/firebase';
import { verifyAuth, optionalAuth } from '../lib/auth';
import { db } from '../lib/db';
import { manuals } from '../lib/schema';
import { eq, desc, ilike, or, and } from 'drizzle-orm';
import { dispatchToAgent } from '../lib/agentClient';

interface PostMedia {
  type: 'image' | 'video';
  url: string;
  thumbnailUrl?: string;
}

interface CreatePostInput {
  body?: string;
  media?: PostMedia[];
  manualId?: string;
  productName?: string;
  productBrand?: string;
  linkUrl?: string;
  tags?: string[];
}

export default async function hubRoutes(fastify: FastifyInstance) {

  // ---------------------------------------------------------------------------
  // 1. PUBLIC / MANUALS SEARCH (Products Forum)
  // ---------------------------------------------------------------------------
  fastify.get('/public/manuals', async (request, reply) => {
    try {
      // Query published manuals from DB
      const allManuals = await db.select().from(manuals).orderBy(desc(manuals.createdAt));

      // Query product_stats from Firestore
      const statsSnapshot = await firestore.collection('product_stats').get();
      const statsMap = new Map<string, any>();
      statsSnapshot.forEach(doc => {
        statsMap.set(doc.id, doc.data());
      });

      // Map to frontend PublicProduct schema
      const mappedProducts = allManuals.map(m => {
        const stats = statsMap.get(m.id) || {};
        return {
          id: m.id,
          productName: m.title,
          brand: 'ClearGuide', // Default or extracted brand
          productModel: undefined,
          avgRating: stats.avgRating || 0,
          reviewCount: stats.reviewCount || 0,
          threadCount: stats.threadCount || 0,
          updatedAt: m.createdAt.toISOString(),
          manualId: m.id,
          storageUrl: m.storageUrl,
        };
      });

      const brands = Array.from(new Set(mappedProducts.map(p => p.brand).filter(Boolean)));

      return reply.send({
        data: mappedProducts,
        brands,
      });
    } catch (error) {
      request.log.error({ error }, 'Failed to fetch public manuals');
      return reply.status(500).send({ error: 'Failed to fetch public manuals' });
    }
  });

  // ---------------------------------------------------------------------------
  // 2. FEED & POSTS CRUD
  // ---------------------------------------------------------------------------

  // GET /posts (List feed with pagination and filters)
  fastify.get('/posts', { preHandler: optionalAuth }, async (request, reply) => {
    try {
      const query = request.query as {
        filter?: 'all' | 'following';
        manualId?: string;
        userId?: string;
        tag?: string;
        limit?: string;
        cursor?: string;
      };

      const limit = Math.min(parseInt(query.limit || '20', 10), 50);
      let postsRef = firestore.collection('hub_posts').orderBy('createdAt', 'desc');

      if (query.manualId) {
        postsRef = firestore.collection('hub_posts').where('manualId', '==', query.manualId).orderBy('createdAt', 'desc');
      } else if (query.userId) {
        postsRef = firestore.collection('hub_posts').where('userId', '==', query.userId).orderBy('createdAt', 'desc');
      }

      if (query.cursor) {
        const cursorDoc = await firestore.collection('hub_posts').doc(query.cursor).get();
        if (cursorDoc.exists) {
          postsRef = postsRef.startAfter(cursorDoc);
        }
      }

      const snapshot = await postsRef.limit(limit + 1).get();
      const docs = snapshot.docs;
      const hasMore = docs.length > limit;
      const pageDocs = hasMore ? docs.slice(0, limit) : docs;
      const nextCursor = hasMore ? pageDocs[pageDocs.length - 1].id : null;

      const currentUid = request.user?.uid;

      // Check liked/bookmarked status if user is authenticated
      const userLikes = new Set<string>();
      const userBookmarks = new Set<string>();

      if (currentUid && pageDocs.length > 0) {
        const postIds = pageDocs.map(d => d.id);
        
        // Fetch likes in parallel
        const likesSnap = await Promise.all(
          postIds.map(pid => firestore.collection('hub_likes').doc(`${pid}_${currentUid}`).get())
        );
        likesSnap.forEach(snap => {
          if (snap.exists) userLikes.add(snap.data()?.postId);
        });

        // Fetch bookmarks in parallel
        const bookmarksSnap = await Promise.all(
          postIds.map(pid => firestore.collection('hub_bookmarks').doc(`${pid}_${currentUid}`).get())
        );
        bookmarksSnap.forEach(snap => {
          if (snap.exists) userBookmarks.add(snap.data()?.postId);
        });
      }

      const posts = pageDocs.map(doc => {
        const data = doc.data();
        return {
          id: doc.id,
          userId: data.userId,
          author: data.author || { name: 'Anonymous', avatarUrl: null },
          body: data.body || '',
          media: data.media || [],
          manualId: data.manualId || null,
          productName: data.productName || null,
          productBrand: data.productBrand || null,
          linkUrl: data.linkUrl || null,
          linkMeta: data.linkMeta || null,
          likeCount: data.likeCount || 0,
          commentCount: data.commentCount || 0,
          tags: data.tags || [],
          isLiked: userLikes.has(doc.id),
          isBookmarked: userBookmarks.has(doc.id),
          createdAt: data.createdAt?.toDate?.()?.toISOString() || new Date().toISOString(),
          updatedAt: data.updatedAt?.toDate?.()?.toISOString() || new Date().toISOString(),
        };
      });

      return reply.send({
        data: posts,
        nextCursor,
      });
    } catch (error) {
      request.log.error({ error }, 'Failed to fetch posts');
      return reply.status(500).send({ error: 'Failed to fetch posts' });
    }
  });

  // POST /posts (Create Post)
  fastify.post('/posts', { preHandler: verifyAuth }, async (request, reply) => {
    try {
      const uid = request.user!.uid;
      const input = request.body as CreatePostInput;

      if (!input.body?.trim() && (!input.media || input.media.length === 0) && !input.linkUrl?.trim()) {
        return reply.status(400).send({ error: 'Post must contain text, media, or a link' });
      }

      if (input.body && input.body.length > 4000) {
        return reply.status(400).send({ error: 'Post body exceeds 4000 characters limit' });
      }

      // Fetch user profile for author snapshot
      const userDoc = await firestore.collection('users').doc(uid).get();
      const userData = userDoc.data() || {};
      const author = {
        name: userData.displayName || request.user?.name || 'Community Member',
        username: userData.username || null,
        avatarUrl: userData.avatarUrl || request.user?.picture || null,
      };

      const now = new Date();
      const postRef = firestore.collection('hub_posts').doc();
      const newPostData = {
        id: postRef.id,
        userId: uid,
        author,
        body: input.body?.trim() || '',
        media: input.media || [],
        manualId: input.manualId || null,
        productName: input.productName || null,
        productBrand: input.productBrand || null,
        linkUrl: input.linkUrl?.trim() || null,
        linkMeta: null,
        likeCount: 0,
        commentCount: 0,
        tags: input.tags || [],
        createdAt: now,
        updatedAt: now,
      };

      await postRef.set(newPostData);

      // Increment user's postCount
      await firestore.collection('users').doc(uid).set({
        postCount: (userData.postCount || 0) + 1,
        updatedAt: now,
      }, { merge: true });

      // Trigger GuideBot AI Moderator response asynchronously (decoupled microservice)
      const aiWorkerUrl = process.env.AGENT_COMMUNITY_MODERATOR_URL
        || (process.env.AI_AGENT_URL
          ? process.env.AI_AGENT_URL.replace('/process-manual', '/community-reply')
          : 'http://localhost:8004/community-reply');

      dispatchToAgent(aiWorkerUrl, {
          postId: postRef.id,
          body: input.body?.trim() || '',
          manualId: input.manualId || null,
      }, 3).catch((err) => {
        request.log.error({ err, postId: postRef.id }, 'GuideBot AI trigger notice');
      });

      return reply.status(201).send({
        data: {
          ...newPostData,
          isLiked: false,
          isBookmarked: false,
          createdAt: now.toISOString(),
          updatedAt: now.toISOString(),
        },
      });

    } catch (error) {
      request.log.error({ error }, 'Failed to create post');
      return reply.status(500).send({ error: 'Failed to create post' });
    }
  });

  // GET /posts/:id (Single Post Detail)
  fastify.get('/posts/:id', { preHandler: optionalAuth }, async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      const doc = await firestore.collection('hub_posts').doc(id).get();

      if (!doc.exists) {
        return reply.status(404).send({ error: 'Post not found' });
      }

      const data = doc.data()!;
      const currentUid = request.user?.uid;

      let isLiked = false;
      let isBookmarked = false;

      if (currentUid) {
        const [likeSnap, bookmarkSnap] = await Promise.all([
          firestore.collection('hub_likes').doc(`${id}_${currentUid}`).get(),
          firestore.collection('hub_bookmarks').doc(`${id}_${currentUid}`).get(),
        ]);
        isLiked = likeSnap.exists;
        isBookmarked = bookmarkSnap.exists;
      }

      return reply.send({
        data: {
          id: doc.id,
          userId: data.userId,
          author: data.author || { name: 'Anonymous', avatarUrl: null },
          body: data.body || '',
          media: data.media || [],
          manualId: data.manualId || null,
          productName: data.productName || null,
          productBrand: data.productBrand || null,
          linkUrl: data.linkUrl || null,
          linkMeta: data.linkMeta || null,
          likeCount: data.likeCount || 0,
          commentCount: data.commentCount || 0,
          tags: data.tags || [],
          isLiked,
          isBookmarked,
          createdAt: data.createdAt?.toDate?.()?.toISOString() || new Date().toISOString(),
          updatedAt: data.updatedAt?.toDate?.()?.toISOString() || new Date().toISOString(),
        },
      });
    } catch (error) {
      request.log.error({ error }, 'Failed to fetch post');
      return reply.status(500).send({ error: 'Failed to fetch post' });
    }
  });

  // PATCH /posts/:id (Edit Post)
  fastify.patch('/posts/:id', { preHandler: verifyAuth }, async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      const uid = request.user!.uid;
      const input = request.body as Partial<CreatePostInput>;

      const postRef = firestore.collection('hub_posts').doc(id);
      const doc = await postRef.get();

      if (!doc.exists) {
        return reply.status(404).send({ error: 'Post not found' });
      }

      const postData = doc.data()!;
      if (postData.userId !== uid) {
        return reply.status(403).send({ error: 'Forbidden: You are not the author of this post' });
      }

      const updates: Record<string, any> = {
        updatedAt: new Date(),
      };

      if (input.body !== undefined) updates.body = input.body.trim();
      if (input.media !== undefined) updates.media = input.media;
      if (input.manualId !== undefined) updates.manualId = input.manualId;
      if (input.productName !== undefined) updates.productName = input.productName;
      if (input.productBrand !== undefined) updates.productBrand = input.productBrand;
      if (input.linkUrl !== undefined) updates.linkUrl = input.linkUrl.trim();
      if (input.tags !== undefined) updates.tags = input.tags;

      await postRef.update(updates);

      const updatedDoc = await postRef.get();
      const updatedData = updatedDoc.data()!;

      return reply.send({
        data: {
          id: updatedDoc.id,
          ...updatedData,
          createdAt: updatedData.createdAt?.toDate?.()?.toISOString() || new Date().toISOString(),
          updatedAt: updatedData.updatedAt?.toDate?.()?.toISOString() || new Date().toISOString(),
        },
      });
    } catch (error) {
      request.log.error({ error }, 'Failed to edit post');
      return reply.status(500).send({ error: 'Failed to edit post' });
    }
  });

  // DELETE /posts/:id (Delete Post)
  fastify.delete('/posts/:id', { preHandler: verifyAuth }, async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      const uid = request.user!.uid;

      const postRef = firestore.collection('hub_posts').doc(id);
      const doc = await postRef.get();

      if (!doc.exists) {
        return reply.status(404).send({ error: 'Post not found' });
      }

      if (doc.data()!.userId !== uid) {
        return reply.status(403).send({ error: 'Forbidden: You are not the author of this post' });
      }

      await postRef.delete();

      // Decrement user's post count
      const userRef = firestore.collection('users').doc(uid);
      const userDoc = await userRef.get();
      if (userDoc.exists) {
        const currentCount = userDoc.data()?.postCount || 1;
        await userRef.update({ postCount: Math.max(0, currentCount - 1) });
      }

      return reply.send({ success: true });
    } catch (error) {
      request.log.error({ error }, 'Failed to delete post');
      return reply.status(500).send({ error: 'Failed to delete post' });
    }
  });

  // ---------------------------------------------------------------------------
  // 3. ENGAGEMENT (LIKE & BOOKMARK)
  // ---------------------------------------------------------------------------

  // POST /posts/:id/like
  fastify.post('/posts/:id/like', { preHandler: verifyAuth }, async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      const uid = request.user!.uid;

      const likeRef = firestore.collection('hub_likes').doc(`${id}_${uid}`);
      const postRef = firestore.collection('hub_posts').doc(id);

      const likeDoc = await likeRef.get();
      if (!likeDoc.exists) {
        await likeRef.set({ postId: id, userId: uid, createdAt: new Date() });
        const postDoc = await postRef.get();
        if (postDoc.exists) {
          await postRef.update({ likeCount: (postDoc.data()?.likeCount || 0) + 1 });
        }
      }

      return reply.send({ success: true, liked: true });
    } catch (error) {
      request.log.error({ error }, 'Failed to like post');
      return reply.status(500).send({ error: 'Failed to like post' });
    }
  });

  // DELETE /posts/:id/like
  fastify.delete('/posts/:id/like', { preHandler: verifyAuth }, async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      const uid = request.user!.uid;

      const likeRef = firestore.collection('hub_likes').doc(`${id}_${uid}`);
      const postRef = firestore.collection('hub_posts').doc(id);

      const likeDoc = await likeRef.get();
      if (likeDoc.exists) {
        await likeRef.delete();
        const postDoc = await postRef.get();
        if (postDoc.exists) {
          const count = postDoc.data()?.likeCount || 1;
          await postRef.update({ likeCount: Math.max(0, count - 1) });
        }
      }

      return reply.send({ success: true, liked: false });
    } catch (error) {
      request.log.error({ error }, 'Failed to unlike post');
      return reply.status(500).send({ error: 'Failed to unlike post' });
    }
  });

  // POST /posts/:id/bookmark
  fastify.post('/posts/:id/bookmark', { preHandler: verifyAuth }, async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      const uid = request.user!.uid;

      const bookmarkRef = firestore.collection('hub_bookmarks').doc(`${id}_${uid}`);
      await bookmarkRef.set({ postId: id, userId: uid, createdAt: new Date() });

      return reply.send({ success: true, bookmarked: true });
    } catch (error) {
      request.log.error({ error }, 'Failed to bookmark post');
      return reply.status(500).send({ error: 'Failed to bookmark post' });
    }
  });

  // DELETE /posts/:id/bookmark
  fastify.delete('/posts/:id/bookmark', { preHandler: verifyAuth }, async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      const uid = request.user!.uid;

      const bookmarkRef = firestore.collection('hub_bookmarks').doc(`${id}_${uid}`);
      await bookmarkRef.delete();

      return reply.send({ success: true, bookmarked: false });
    } catch (error) {
      request.log.error({ error }, 'Failed to unbookmark post');
      return reply.status(500).send({ error: 'Failed to unbookmark post' });
    }
  });

  // GET /bookmarks (Bookmarked Posts feed)
  fastify.get('/bookmarks', { preHandler: verifyAuth }, async (request, reply) => {
    try {
      const uid = request.user!.uid;

      const bookmarksSnap = await firestore.collection('hub_bookmarks')
        .where('userId', '==', uid)
        .orderBy('createdAt', 'desc')
        .get();

      const postIds = bookmarksSnap.docs.map(d => d.data().postId);
      if (postIds.length === 0) {
        return reply.send({ data: [] });
      }

      const postsSnap = await Promise.all(
        postIds.map(pid => firestore.collection('hub_posts').doc(pid).get())
      );

      const posts = postsSnap
        .filter(snap => snap.exists)
        .map(snap => {
          const data = snap.data()!;
          return {
            id: snap.id,
            userId: data.userId,
            author: data.author || { name: 'Anonymous', avatarUrl: null },
            body: data.body || '',
            media: data.media || [],
            manualId: data.manualId || null,
            productName: data.productName || null,
            productBrand: data.productBrand || null,
            linkUrl: data.linkUrl || null,
            linkMeta: data.linkMeta || null,
            likeCount: data.likeCount || 0,
            commentCount: data.commentCount || 0,
            tags: data.tags || [],
            isLiked: false,
            isBookmarked: true,
            createdAt: data.createdAt?.toDate?.()?.toISOString() || new Date().toISOString(),
            updatedAt: data.updatedAt?.toDate?.()?.toISOString() || new Date().toISOString(),
          };
        });

      return reply.send({ data: posts });
    } catch (error) {
      request.log.error({ error }, 'Failed to fetch bookmarks');
      return reply.status(500).send({ error: 'Failed to fetch bookmarks' });
    }
  });

  // ---------------------------------------------------------------------------
  // 4. COMMENTS THREAD
  // ---------------------------------------------------------------------------

  // GET /posts/:id/comments
  fastify.get('/posts/:id/comments', async (request, reply) => {
    try {
      const { id } = request.params as { id: string };

      const snapshot = await firestore.collection('hub_posts').doc(id)
        .collection('comments')
        .orderBy('createdAt', 'asc')
        .get();

      const comments = snapshot.docs.map(doc => {
        const data = doc.data();
        return {
          id: doc.id,
          postId: id,
          userId: data.userId,
          author: data.author || { name: 'Anonymous', avatarUrl: null },
          body: data.body || '',
          parentId: data.parentId || null,
          likeCount: data.likeCount || 0,
          createdAt: data.createdAt?.toDate?.()?.toISOString() || new Date().toISOString(),
        };
      });

      return reply.send({ data: comments });
    } catch (error) {
      request.log.error({ error }, 'Failed to fetch comments');
      return reply.status(500).send({ error: 'Failed to fetch comments' });
    }
  });

  // POST /posts/:id/comments
  fastify.post('/posts/:id/comments', { preHandler: verifyAuth }, async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      const uid = request.user!.uid;
      const { body, parentId } = request.body as { body?: string; parentId?: string };

      if (!body?.trim()) {
        return reply.status(400).send({ error: 'Comment body cannot be empty' });
      }

      const postRef = firestore.collection('hub_posts').doc(id);
      const postDoc = await postRef.get();

      if (!postDoc.exists) {
        return reply.status(404).send({ error: 'Post not found' });
      }

      // Fetch author profile
      const userDoc = await firestore.collection('users').doc(uid).get();
      const userData = userDoc.data() || {};
      const author = {
        name: userData.displayName || request.user?.name || 'Community Member',
        username: userData.username || null,
        avatarUrl: userData.avatarUrl || request.user?.picture || null,
      };

      const commentRef = postRef.collection('comments').doc();
      const now = new Date();
      const commentData = {
        id: commentRef.id,
        postId: id,
        userId: uid,
        author,
        body: body.trim(),
        parentId: parentId || null,
        likeCount: 0,
        createdAt: now,
      };

      await commentRef.set(commentData);

      // Increment comment count on post
      await postRef.update({
        commentCount: (postDoc.data()?.commentCount || 0) + 1,
      });

      return reply.status(201).send({
        data: {
          ...commentData,
          createdAt: now.toISOString(),
        },
      });
    } catch (error) {
      request.log.error({ error }, 'Failed to post comment');
      return reply.status(500).send({ error: 'Failed to post comment' });
    }
  });

  // ---------------------------------------------------------------------------
  // 5. PROFILES & SOCIAL NETWORK
  // ---------------------------------------------------------------------------

  // GET /profiles/:usernameOrId
  fastify.get('/profiles/:usernameOrId', { preHandler: optionalAuth }, async (request, reply) => {
    try {
      const { usernameOrId } = request.params as { usernameOrId: string };
      const lowerIdentifier = usernameOrId.toLowerCase();

      let userDoc = await firestore.collection('users').doc(usernameOrId).get();

      if (!userDoc.exists) {
        const querySnap = await firestore.collection('users')
          .where('username', '==', lowerIdentifier)
          .limit(1)
          .get();

        if (!querySnap.empty) {
          userDoc = querySnap.docs[0];
        }
      }

      if (!userDoc.exists) {
        return reply.status(404).send({ error: 'User profile not found' });
      }

      const data = userDoc.data()!;
      const profileUid = userDoc.id;
      const currentUid = request.user?.uid;

      let isFollowing = false;
      if (currentUid && currentUid !== profileUid) {
        const followSnap = await firestore.collection('hub_follows').doc(`${currentUid}_${profileUid}`).get();
        isFollowing = followSnap.exists;
      }

      return reply.send({
        data: {
          id: profileUid,
          name: data.displayName || 'Community Member',
          displayName: data.displayName || null,
          username: data.username || null,
          avatarUrl: data.avatarUrl || null,
          bio: data.bio || null,
          location: data.location || null,
          websiteUrl: data.websiteUrl || null,
          repairSpecialty: data.repairSpecialty || [],
          postCount: data.postCount || 0,
          followerCount: data.followerCount || 0,
          followingCount: data.followingCount || 0,
          isFollowing,
          createdAt: data.createdAt?.toDate?.()?.toISOString() || new Date().toISOString(),
        },
      });
    } catch (error) {
      request.log.error({ error }, 'Failed to fetch profile');
      return reply.status(500).send({ error: 'Failed to fetch profile' });
    }
  });

  // PATCH /profiles/me (Update Own Profile)
  fastify.patch('/profiles/me', { preHandler: verifyAuth }, async (request, reply) => {
    try {
      const uid = request.user!.uid;
      const body = request.body as {
        displayName?: string | null;
        username?: string | null;
        bio?: string | null;
        location?: string | null;
        websiteUrl?: string | null;
        repairSpecialty?: string[];
        avatarUrl?: string | null;
      };

      const userRef = firestore.collection('users').doc(uid);
      const userDoc = await userRef.get();

      let currentUsername = userDoc.exists ? userDoc.data()?.username : null;
      let newUsername = body.username ? body.username.trim().toLowerCase() : null;

      // Validate handle format if provided
      if (newUsername && newUsername !== currentUsername) {
        if (!/^[a-z0-9_]{3,30}$/.test(newUsername)) {
          return reply.status(400).send({ error: 'Username must be 3-30 characters: letters, numbers, underscores' });
        }

        // Check handle uniqueness
        const existingSnap = await firestore.collection('users')
          .where('username', '==', newUsername)
          .limit(1)
          .get();

        if (!existingSnap.empty && existingSnap.docs[0].id !== uid) {
          return reply.status(400).send({ error: 'Username is already taken' });
        }
      }

      const updates: Record<string, any> = {
        updatedAt: new Date(),
      };

      if (body.displayName !== undefined) updates.displayName = body.displayName?.trim() || null;
      if (body.username !== undefined) updates.username = newUsername;
      if (body.bio !== undefined) updates.bio = body.bio?.trim() || null;
      if (body.location !== undefined) updates.location = body.location?.trim() || null;
      if (body.websiteUrl !== undefined) updates.websiteUrl = body.websiteUrl?.trim() || null;
      if (body.repairSpecialty !== undefined) updates.repairSpecialty = body.repairSpecialty;
      if (body.avatarUrl !== undefined) updates.avatarUrl = body.avatarUrl;

      if (!userDoc.exists) {
        updates.createdAt = new Date();
        updates.postCount = 0;
        updates.followerCount = 0;
        updates.followingCount = 0;
      }

      await userRef.set(updates, { merge: true });

      const updatedSnap = await userRef.get();
      const updatedData = updatedSnap.data()!;

      return reply.send({
        data: {
          id: uid,
          name: updatedData.displayName || 'Community Member',
          ...updatedData,
          createdAt: updatedData.createdAt?.toDate?.()?.toISOString() || new Date().toISOString(),
        },
      });
    } catch (error) {
      request.log.error({ error }, 'Failed to update profile');
      return reply.status(500).send({ error: 'Failed to update profile' });
    }
  });

  // POST /profiles/:id/follow & DELETE /profiles/:id/follow
  fastify.post('/profiles/:id/follow', { preHandler: verifyAuth }, async (request, reply) => {
    try {
      const { id: targetUid } = request.params as { id: string };
      const currentUid = request.user!.uid;

      if (currentUid === targetUid) {
        return reply.status(400).send({ error: 'Cannot follow yourself' });
      }

      const followRef = firestore.collection('hub_follows').doc(`${currentUid}_${targetUid}`);
      const followSnap = await followRef.get();

      if (!followSnap.exists) {
        await followRef.set({ followerId: currentUid, followingId: targetUid, createdAt: new Date() });

        // Update counts
        const currentUserRef = firestore.collection('users').doc(currentUid);
        const targetUserRef = firestore.collection('users').doc(targetUid);

        const [cDoc, tDoc] = await Promise.all([currentUserRef.get(), targetUserRef.get()]);
        if (cDoc.exists) await currentUserRef.update({ followingCount: (cDoc.data()?.followingCount || 0) + 1 });
        if (tDoc.exists) await targetUserRef.update({ followerCount: (tDoc.data()?.followerCount || 0) + 1 });
      }

      return reply.send({ success: true, isFollowing: true });
    } catch (error) {
      request.log.error({ error }, 'Failed to follow user');
      return reply.status(500).send({ error: 'Failed to follow user' });
    }
  });

  fastify.delete('/profiles/:id/follow', { preHandler: verifyAuth }, async (request, reply) => {
    try {
      const { id: targetUid } = request.params as { id: string };
      const currentUid = request.user!.uid;

      const followRef = firestore.collection('hub_follows').doc(`${currentUid}_${targetUid}`);
      const followSnap = await followRef.get();

      if (followSnap.exists) {
        await followRef.delete();

        // Update counts
        const currentUserRef = firestore.collection('users').doc(currentUid);
        const targetUserRef = firestore.collection('users').doc(targetUid);

        const [cDoc, tDoc] = await Promise.all([currentUserRef.get(), targetUserRef.get()]);
        if (cDoc.exists) await currentUserRef.update({ followingCount: Math.max(0, (cDoc.data()?.followingCount || 1) - 1) });
        if (tDoc.exists) await targetUserRef.update({ followerCount: Math.max(0, (tDoc.data()?.followerCount || 1) - 1) });
      }

      return reply.send({ success: true, isFollowing: false });
    } catch (error) {
      request.log.error({ error }, 'Failed to unfollow user');
      return reply.status(500).send({ error: 'Failed to unfollow user' });
    }
  });
}
