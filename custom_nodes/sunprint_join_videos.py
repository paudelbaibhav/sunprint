import os

import av
import folder_paths
from comfy_api.latest import Types

# Used by the Sunprint studio's "Extend by 5 s": saves the new part, then joins it onto the
# previous MP4 by copying packets (no re-encode, and no need to load the old clip's frames
# into memory). Both clips come from the same Wan pipeline, so their streams match.


def _remux(parts, out_path):
    with av.open(parts[0]) as first:
        template = first.streams.video[0]
        out = av.open(out_path, "w")
        ostream = out.add_stream_from_template(template)
    try:
        offset = 0  # in ostream.time_base units
        for path in parts:
            with av.open(path) as inp:
                stream = inp.streams.video[0]
                end = offset
                for pkt in inp.demux(stream):
                    if pkt.dts is None:
                        continue
                    pts = int(pkt.pts * stream.time_base / ostream.time_base)
                    dts = int(pkt.dts * stream.time_base / ostream.time_base)
                    dur = int(pkt.duration * stream.time_base / ostream.time_base)
                    pkt.pts, pkt.dts = pts + offset, dts + offset
                    pkt.stream = ostream
                    out.mux(pkt)
                    end = max(end, pkt.pts + dur)
                offset = end
    finally:
        out.close()


class SunprintJoinVideos:
    @classmethod
    def INPUT_TYPES(s):
        return {"required": {
            "video": ("VIDEO", {"tooltip": "The new part, added after the previous clip."}),
            "previous": ("STRING", {"default": "", "tooltip": "The previous clip, relative to the output folder (e.g. video/seg_00001_.mp4)."}),
            "filename_prefix": ("STRING", {"default": "video/extended"}),
        }}

    RETURN_TYPES = ()
    FUNCTION = "join"
    OUTPUT_NODE = True
    CATEGORY = "video"

    def join(self, video, previous, filename_prefix):
        output_dir = folder_paths.get_output_directory()
        previous_path = os.path.abspath(os.path.join(output_dir, previous))
        if os.path.commonpath((output_dir, previous_path)) != output_dir or not os.path.isfile(previous_path):
            raise ValueError(f"Previous clip not found in the output folder: {previous!r}")

        width, height = video.get_dimensions()
        full_output_folder, filename, counter, subfolder, _ = folder_paths.get_save_image_path(filename_prefix, output_dir, width, height)
        temp_dir = folder_paths.get_temp_directory()
        os.makedirs(temp_dir, exist_ok=True)
        part = os.path.join(temp_dir, f"sunprint_part_{counter:05}.mp4")
        video.save_to(part, format=Types.VideoContainer("mp4"), codec=Types.VideoCodec("auto"))

        file = f"{filename}_{counter:05}_.mp4"
        try:
            _remux([previous_path, part], os.path.join(full_output_folder, file))
        finally:
            os.remove(part)
        return {"ui": {"images": [{"filename": file, "subfolder": subfolder, "type": "output"}], "animated": (True,)}}


def _output_path(output_dir, name):
    path = os.path.abspath(os.path.join(output_dir, name))
    if os.path.commonpath((output_dir, path)) != output_dir or not os.path.isfile(path):
        raise ValueError(f"Clip not found in the output folder: {name!r}")
    return path


class SunprintConcatVideos:
    """Used by the Sunprint studio's campaigns: joins finished shot clips into one video, in order (hard cuts)."""

    @classmethod
    def INPUT_TYPES(s):
        return {"required": {
            "videos": ("STRING", {"multiline": True, "default": "", "tooltip": "One clip per line, relative to the output folder, in playing order."}),
            "filename_prefix": ("STRING", {"default": "campaign/ad"}),
        }}

    RETURN_TYPES = ()
    FUNCTION = "concat"
    OUTPUT_NODE = True
    CATEGORY = "video"

    def concat(self, videos, filename_prefix):
        output_dir = folder_paths.get_output_directory()
        parts = [_output_path(output_dir, line.strip()) for line in videos.splitlines() if line.strip()]
        if not parts:
            raise ValueError("No clips to join.")
        with av.open(parts[0]) as first:
            stream = first.streams.video[0]
            width, height = stream.codec_context.width, stream.codec_context.height
        full_output_folder, filename, counter, subfolder, _ = folder_paths.get_save_image_path(filename_prefix, output_dir, width, height)
        file = f"{filename}_{counter:05}_.mp4"
        _remux(parts, os.path.join(full_output_folder, file))
        return {"ui": {"images": [{"filename": file, "subfolder": subfolder, "type": "output"}], "animated": (True,)}}


NODE_CLASS_MAPPINGS = {
    "SunprintJoinVideos": SunprintJoinVideos,
    "SunprintConcatVideos": SunprintConcatVideos,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "SunprintJoinVideos": "Join Videos (Sunprint)",
    "SunprintConcatVideos": "Join Clips In Order (Sunprint)",
}
