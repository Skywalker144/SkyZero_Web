import torch
import glob
import os
import numpy as np
from nets import ResNet
from tictactoe import TicTacToe
from connect4 import Connect4
from gomoku import Gomoku

def find_latest_checkpoint(prefix):
    pattern = f"checkpoints/{prefix}_checkpoint_*.pth"
    files = glob.glob(pattern)
    if not files:
        return None
    files.sort(reverse=True)
    return files[0]

def export_model(game_name, game, model, checkpoint_prefix, dummy_input_shape):
    print(f"Exporting {game_name}...")
    
    # Load checkpoint
    ckpt_path = find_latest_checkpoint(checkpoint_prefix)
    if not ckpt_path:
        print(f"  No checkpoint found for {game_name}. Skipping.")
        return

    print(f"  Loading checkpoint: {ckpt_path}")
    device = torch.device('cpu') # Export on CPU
    try:
        # Fix for PyTorch 2.6+ default security setting
        checkpoint = torch.load(ckpt_path, map_location=device, weights_only=False)
        state_dict = checkpoint.get('model_state_dict', checkpoint)
        model.load_state_dict(state_dict)
    except Exception as e:
        print(f"  Error loading checkpoint: {e}")
        return

    model.eval()
    model.to(device)

    # Create dummy input
    dummy_input = torch.randn(*dummy_input_shape, device=device)
    
    # Export
    output_path = f"{game_name}.onnx"
    
    # Dynamic axes for batch size (though usually 1 for MCTS, flexibility is good)
    dynamic_axes = {
        'input': {0: 'batch_size'},
        'policy': {0: 'batch_size'},
        'value': {0: 'batch_size'}
    }

    try:
        torch.onnx.export(
            model,
            dummy_input,
            output_path,
            export_params=True,
            opset_version=12,
            do_constant_folding=True,
            input_names=['input'],
            output_names=['policy', 'value'],
            dynamic_axes=dynamic_axes
        )
        print(f"  Successfully exported to {output_path}")
    except Exception as e:
        print(f"  Error exporting ONNX: {e}")

def main():
    # 1. TicTacToe
    # app.py: TicTacToe(history_step=3), ResNet(game, num_blocks=1)
    game_ttt = TicTacToe(history_step=3)
    model_ttt = ResNet(game_ttt, num_blocks=1)
    # input shape: (1, num_planes, 3, 3)
    shape_ttt = (1, game_ttt.num_planes, 3, 3)
    export_model("tictactoe", game_ttt, model_ttt, "tictactoe", shape_ttt)

    # 2. Connect4
    # app.py: Connect4(history_step=3), ResNet(game, num_blocks=2, num_channels=128)
    game_c4 = Connect4(history_step=3)
    model_c4 = ResNet(game_c4, num_blocks=2, num_channels=128)
    # input shape: (1, num_planes, 6, 7)
    shape_c4 = (1, game_c4.num_planes, 6, 7)
    export_model("connect4", game_c4, model_c4, "connect4", shape_c4)

    # 3. Gomoku
    # app.py: Gomoku(board_size=9, history_step=4), ResNet(game, num_blocks=4, num_channels=256)
    game_gomoku = Gomoku(board_size=9, history_step=4)
    model_gomoku = ResNet(game_gomoku, num_blocks=4, num_channels=256)
    # input shape: (1, num_planes, 9, 9)
    shape_gomoku = (1, game_gomoku.num_planes, 9, 9)
    export_model("gomoku", game_gomoku, model_gomoku, "gomoku9", shape_gomoku)

if __name__ == "__main__":
    main()
