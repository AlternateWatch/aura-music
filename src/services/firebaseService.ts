import {
  collection,
  doc,
  setDoc,
  getDocs,
  getDoc,
  query,
  where,
  Timestamp,
  updateDoc,
  deleteDoc,
  serverTimestamp,
} from "firebase/firestore";
import { ref, uploadBytesResumable, getDownloadURL } from "firebase/storage";
import {
  db,
  storage,
  auth,
  handleFirestoreError,
  OperationType,
} from "../lib/firebase";
import { Song, Playlist } from "../constants";

export const firebaseService = {
  async ensureUserDoc() {
    if (!auth.currentUser) return;
    const userRef = doc(db, "users", auth.currentUser.uid);
    try {
      const snap = await getDoc(userRef);
      if (!snap.exists()) {
        const userData: any = {
          email: auth.currentUser.email,
          role: "user", // default
          createdAt: serverTimestamp(),
        };

        if (auth.currentUser.displayName) {
          userData.displayName = auth.currentUser.displayName;
        }

        await setDoc(userRef, userData);
      }
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, "users");
    }
  },

  async getUserRole(): Promise<string> {
    if (!auth.currentUser) return "user";
    if (auth.currentUser.email === "abasildorodriguez@gmail.com") return "admin";
    try {
      const snap = await getDoc(doc(db, "users", auth.currentUser.uid));
      return snap.data()?.role || "user";
    } catch (err) {
      handleFirestoreError(err, OperationType.GET, "users");
      return "user";
    }
  },

  async getSongs(
    statusFilter?: "pending" | "approved" | "rejected",
  ): Promise<Song[]> {
    if (!auth.currentUser) return [];
    try {
      const q = statusFilter
        ? query(collection(db, "songs"), where("status", "==", statusFilter))
        : collection(db, "songs");
      const snap = await getDocs(q);
      return snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Song);
    } catch (err) {
      handleFirestoreError(err, OperationType.LIST, "songs");
      return [];
    }
  },

  async getMySongs(): Promise<Song[]> {
    if (!auth.currentUser) return [];
    try {
      const q = query(
        collection(db, "songs"),
        where("uploaderId", "==", auth.currentUser.uid),
      );
      const snap = await getDocs(q);
      return snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Song);
    } catch (err) {
      handleFirestoreError(err, OperationType.LIST, "songs");
      return [];
    }
  },

  async getMyPlaylists(): Promise<Playlist[]> {
    if (!auth.currentUser) return [];
    try {
      const q = query(
        collection(db, "playlists"),
        where("ownerId", "==", auth.currentUser.uid),
      );
      const snap = await getDocs(q);
      return snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Playlist);
    } catch (err) {
      handleFirestoreError(err, OperationType.LIST, "playlists");
      return [];
    }
  },

  async createPlaylist(playlist: Playlist): Promise<void> {
    try {
      await setDoc(doc(db, "playlists", playlist.id), {
        ...playlist,
        createdAt: serverTimestamp(),
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, "playlists");
    }
  },

  async updatePlaylist(id: string, data: Partial<Playlist>): Promise<void> {
    try {
      await updateDoc(doc(db, "playlists", id), data);
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `playlists/${id}`);
    }
  },

  async deletePlaylist(id: string): Promise<void> {
    try {
      await deleteDoc(doc(db, "playlists", id));
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `playlists/${id}`);
    }
  },

  async uploadFile(
    file: File,
    path: string,
    onProgress?: (p: number) => void,
  ): Promise<string> {
    if (!auth.currentUser) throw new Error("Not logged in");

    try {
      // Use Firebase Storage instead of Firestore chunks
      const storageRef = ref(storage, `covers/${Date.now()}_${file.name}`);
      const uploadTask = uploadBytesResumable(storageRef, file);

      return new Promise((resolve, reject) => {
        uploadTask.on(
          "state_changed",
          (snapshot) => {
            if (onProgress) {
              const progress = (snapshot.bytesTransferred / snapshot.totalBytes) * 100;
              onProgress(Math.round(progress));
            }
          },
          (error) => reject(error),
          async () => {
            const downloadURL = await getDownloadURL(uploadTask.snapshot.ref);
            resolve(downloadURL);
          }
        );
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, "storage");
      throw err;
    }
  },

  async getFileUrl(url: string): Promise<string> {
    if (!url.startsWith("firestore-file://")) return url;

    const id = url.replace("firestore-file://", "");
    const q = query(collection(db, "file_chunks"), where("fileId", "==", id));

    try {
      const snap = await getDocs(q);
      if (snap.empty) return "";

      const chunks = snap.docs.map(
        (d) => d.data() as { index: number; data: string },
      );
      chunks.sort((a, b) => a.index - b.index);

      let dataUrl = "";
      for (const chunk of chunks) {
        dataUrl += chunk.data;
      }
      return dataUrl;
    } catch (e) {
      console.error("Error fetching file chunks", e);
      return "";
    }
  },

  async createSong(songData: Song): Promise<void> {
    try {
      await setDoc(doc(db, "songs", songData.id), songData);
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, "songs");
    }
  },

  async updateSongStatus(
    songId: string,
    status: "approved" | "rejected",
  ): Promise<void> {
    try {
      await updateDoc(doc(db, "songs", songId), {
        status,
        updatedAt: serverTimestamp(),
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `songs/${songId}`);
    }
  },

  async deleteSong(songId: string): Promise<void> {
    try {
      await deleteDoc(doc(db, "songs", songId));
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `songs/${songId}`);
    }
  },
};
