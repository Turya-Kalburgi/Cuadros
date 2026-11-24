import argparse, json, os
import cv2
import numpy as np

COCO_PERSON = 1
COCO_PHONE = 67


def ahash(frame):
    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
    small = cv2.resize(gray, (16, 16), interpolation=cv2.INTER_AREA)
    avg = small.mean()
    return "".join("1" if value > avg else "0" for value in small.flatten())


def load_detector(models):
    path = os.path.join(models, "ssd-mobilenet-v2-coco.onnx")
    if not os.path.exists(path):
        return None
    try:
        return cv2.dnn.readNetFromONNX(path)
    except Exception:
        return None


def detect_objects(net, frame):
    if net is None:
        return 0, False
    rgb = cv2.resize(cv2.cvtColor(frame, cv2.COLOR_BGR2RGB), (300, 300))
    try:
        net.setInput(rgb[None].astype(np.uint8))
        result = net.forward(["detection_boxes:0", "detection_scores:0", "detection_classes:0", "num_detections:0"])
        scores = result[1].reshape(-1)
        classes = result[2].reshape(-1)
        count = int(result[3].reshape(-1)[0])
        people = 0
        phone = False
        for i in range(min(count, len(scores))):
            score = float(scores[i])
            cls = int(classes[i])
            if score < 0.42:
                continue
            if cls == COCO_PERSON and score > 0.5:
                people += 1
            if cls == COCO_PHONE and score > 0.32:
                phone = True
        return people, phone
    except Exception:
        return 0, False


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--video", required=True)
    parser.add_argument("--models", required=True)
    parser.add_argument("--shots", required=True)
    parser.add_argument("--frames", type=int, default=2)
    args = parser.parse_args()

    shots = json.loads(args.shots)
    result = {"dominant": None, "identities": {}, "shots": []}

    try:
        detector = cv2.FaceDetectorYN_create(
            os.path.join(args.models, "yunet.onnx"),
            "",
            (320, 320),
            0.72,
            0.3,
            5000,
        )
        recognizer = cv2.FaceRecognizerSF_create(os.path.join(args.models, "sface.onnx"), "")
        objects = load_detector(args.models)
        cap = cv2.VideoCapture(args.video)
        fps = cap.get(cv2.CAP_PROP_FPS) or 30
        total = max(0, int(cap.get(cv2.CAP_PROP_FRAME_COUNT)))
        reps = []
        counts = {}

        for shot in shots:
            start = max(0.0, float(shot.get("start", 0)))
            end = max(start + 0.1, float(shot.get("end", start + 1)))
            ids = set()
            frame_hash = ""
            face_ratio = 0.0
            motion = 0.0
            edge = 0.0
            sharpness = 0.0
            brightness = 0.0
            contrast = 0.0
            face_bright = 0.0
            face_min = 0.0
            face_count = 0
            color = [0.0, 0.0, 0.0]
            phone = False
            people = 0
            previous_gray = None

            for j in range(max(1, args.frames)):
                t = start + (end - start) * (j + 0.5) / max(1, args.frames)
                frame_no = min(max(0, int(t * fps)), max(0, total - 1))
                cap.set(cv2.CAP_PROP_POS_FRAMES, frame_no)
                ok, frame = cap.read()
                if not ok:
                    continue
                if not frame_hash:
                    frame_hash = ahash(frame)
                    color = [float(v) for v in cv2.mean(frame)[:3]]
                gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
                brightness += float(gray.mean())
                contrast += float(gray.std())
                sharpness += float(cv2.Laplacian(gray, cv2.CV_64F).var())
                if previous_gray is not None:
                    motion = max(motion, float(cv2.absdiff(gray, previous_gray).mean()) / 255.0)
                previous_gray = gray
                if j == 0:
                    edge = float(cv2.Canny(gray, 80, 180).mean()) / 255.0
                    frame_people, frame_phone = detect_objects(objects, frame)
                    people = max(people, frame_people)
                    phone = phone or frame_phone
                height, width = frame.shape[:2]
                detector.setInputSize((width, height))
                _, faces = detector.detect(frame)
                if faces is None:
                    continue
                for face in faces:
                    box = face[:4]
                    face_ratio = max(
                        face_ratio,
                        max(float(box[2] - box[0]), float(box[3] - box[1])) / max(width, height),
                    )
                    crop = recognizer.alignCrop(frame, face)
                    face_gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY)
                    face_bright += float(face_gray.mean())
                    face_min += float(np.percentile(face_gray, 10))
                    face_count += 1
                    feature = recognizer.feature(crop)
                    best_id = -1
                    best_score = -1.0
                    for idx, rep in enumerate(reps):
                        score = float(recognizer.match(feature, rep, cv2.FACE_RECOGNIZER_SF_FR_COSINE))
                        if score > best_score:
                            best_score = score
                            best_id = idx
                    if best_id >= 0 and best_score >= 0.363:
                        face_id = best_id
                    else:
                        face_id = len(reps)
                        reps.append(feature)
                    ids.add(face_id)
                    counts[face_id] = counts.get(face_id, 0) + 1

            frames_seen = max(1, args.frames)
            if face_ratio > 0.28:
                kind = "close"
            elif face_ratio > 0.05:
                kind = "wide"
            elif motion > 0.10:
                kind = "active"
            elif edge > 0.14:
                kind = "detail"
            else:
                kind = "wide"
            result["shots"].append(
                {
                    "ids": sorted(ids),
                    "hash": frame_hash,
                    "kind": kind,
                    "faceless": face_ratio <= 0,
                    "motion": round(motion, 3),
                    "edge": round(edge, 3),
                    "faceSize": round(face_ratio, 3),
                    "phone": phone,
                    "people": people,
                    "sharp": round(sharpness / frames_seen, 1),
                    "bright": round(brightness / frames_seen, 1),
                    "contrast": round(contrast / frames_seen, 1),
                    "faceBright": round(face_bright / max(1, face_count), 1),
                    "faceMin": round(face_min / max(1, face_count), 1),
                    "color": [round(v, 1) for v in color],
                }
            )

        cap.release()
        result["identities"] = {str(key): value for key, value in counts.items()}
        if counts:
            result["dominant"] = max(counts, key=counts.get)

        dominant = result["dominant"]
        for shot in result["shots"]:
            ids = shot["ids"]
            shot["otherFaces"] = bool(dominant is not None and any(i != dominant for i in ids))
            shot["mainFace"] = bool(dominant is not None and dominant in ids)
    except Exception as exc:
        result["error"] = str(exc)

    print(json.dumps(result))


main()
