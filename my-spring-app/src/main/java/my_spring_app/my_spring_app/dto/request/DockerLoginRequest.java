package my_spring_app.my_spring_app.dto.request;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

@Data
@NoArgsConstructor
@AllArgsConstructor
public class DockerLoginRequest {
    /**
     * IP address của controller server (optional, nếu không có sẽ tự động tìm)
     */
    private String controllerHost;

    /**
     * Docker Hub username
     */
    private String username;

    /**
     * Docker Hub password
     */
    private String password;

    /**
     * Sudo password (optional nếu đã có SSH key + sudo NOPASSWD)
     */
    private String sudoPassword;
}

